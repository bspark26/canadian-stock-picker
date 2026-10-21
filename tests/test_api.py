import json
import subprocess
import sys
import types

import pytest

from api import handler


ORIGIN = "https://bspark26.github.io"


@pytest.fixture(autouse=True)
def configured_origin(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGIN", ORIGIN)


def request(path="/analyze", symbol="SHOP.TO", method="GET", origin=ORIGIN):
    return {"version": "2.0", "rawPath": path, "requestContext": {"http": {"method": method}}, "headers": {"Origin": origin} if origin else {}, "queryStringParameters": {"symbol": symbol}}


def body(response):
    return json.loads(response["body"])


def test_health_and_preflight_do_not_load_scanner_or_service():
    code = """
import sys
from api.handler import lambda_handler
for method in ('GET', 'OPTIONS'):
    result = lambda_handler({'httpMethod': method, 'path': '/health'})
    assert result['statusCode'] in (200, 204)
assert 'api.service' not in sys.modules
assert not any(name == 'scanner' or name.startswith('scanner.') for name in sys.modules)
assert 'pandas' not in sys.modules and 'yfinance' not in sys.modules
"""
    subprocess.run([sys.executable, "-c", code], check=True)


def test_analysis_normalizes_symbol_and_preserves_service_wrapper(monkeypatch):
    seen = []
    result = {"schemaVersion": 1, "status": "complete", "opportunity": {"symbol": "SHOP.TO"}, "warnings": []}
    monkeypatch.setattr(handler, "_analyze", lambda symbol: seen.append(symbol) or result)
    response = handler.lambda_handler(request(symbol=" shop.to "))
    assert response["statusCode"] == 200
    assert seen == ["SHOP.TO"]
    assert body(response) == result
    assert response["headers"]["Access-Control-Allow-Origin"] == ORIGIN
    assert response["headers"]["Cache-Control"] == "no-store"
    assert not response["isBase64Encoded"]


@pytest.mark.parametrize("symbol", ["", None, "A" * 25, "SHOP TO", "https://example.com", "../SHOP", "SHOP&force=true", "ＳＨＯＰ.TO", "^GSPTSE", "CAD=X", ["SHOP.TO"]])
def test_invalid_symbols_fail_before_service_import(monkeypatch, symbol):
    monkeypatch.setattr(handler, "_analyze", lambda _: pytest.fail("Invalid inputs must not invoke analysis"))
    response = handler.lambda_handler(request(symbol=symbol))
    assert response["statusCode"] == 400
    assert body(response)["error"]["code"] == "invalid_symbol"


def test_duplicate_and_percent_encoded_query_symbols(monkeypatch):
    seen = []
    monkeypatch.setattr(handler, "_analyze", lambda symbol: seen.append(symbol) or {"symbol": symbol})
    event = request(); event["rawQueryString"] = "symbol=SHOP.TO&symbol=LSPD.TO"
    assert handler.lambda_handler(event)["statusCode"] == 400
    event["rawQueryString"] = "symbol=SHOP%2ETO"
    assert handler.lambda_handler(event)["statusCode"] == 200
    assert seen == ["SHOP.TO"]
    event = request(); event["multiValueQueryStringParameters"] = {"symbol": ["SHOP.TO", "LSPD.TO"]}
    assert handler.lambda_handler(event)["statusCode"] == 400


@pytest.mark.parametrize("raw", ["symbol=SHOP.TO&" + "a" * 256, "symbol=SHOP.TO&a=1&b=2&c=3&d=4", "symbol=SHOP.TO&broken-field", {"symbol": "SHOP.TO"}])
def test_query_limits_reject_long_overfull_or_malformed_input_before_analysis(monkeypatch, raw):
    monkeypatch.setattr(handler, "_analyze", lambda _: pytest.fail("Invalid queries must not invoke analysis"))
    event = request(); event["rawQueryString"] = raw
    response = handler.lambda_handler(event)
    assert response["statusCode"] == 400
    assert body(response)["error"]["code"] == "invalid_symbol"


def test_route_method_and_origin_fail_before_analysis(monkeypatch):
    monkeypatch.setattr(handler, "_analyze", lambda _: pytest.fail("Rejected requests must not invoke analysis"))
    assert handler.lambda_handler(request(path="/unknown"))["statusCode"] == 404
    wrong_method = handler.lambda_handler(request(method="POST"))
    assert wrong_method["statusCode"] == 405
    assert wrong_method["headers"]["Allow"] == "GET, OPTIONS"
    denied = handler.lambda_handler(request(origin="https://example.com"))
    assert denied["statusCode"] == 403
    assert "Access-Control-Allow-Origin" not in denied["headers"]
    assert handler.lambda_handler(request(path="/health", origin=None))["statusCode"] == 200
    assert handler.lambda_handler(None)["statusCode"] == 400
    assert handler.lambda_handler({"requestContext": [], "headers": []})["statusCode"] == 400


def test_preflight_and_v1_health(monkeypatch):
    monkeypatch.setattr(handler, "_analyze", lambda _: pytest.fail("Health and OPTIONS must not invoke analysis"))
    response = handler.lambda_handler(request(method="OPTIONS"))
    assert response["statusCode"] == 204 and response["body"] == ""
    assert response["headers"]["Access-Control-Allow-Methods"] == "GET, OPTIONS"
    assert body(handler.lambda_handler({"httpMethod": "GET", "path": "/health/"})) == {"status": "ok"}


def test_only_approved_service_errors_reach_the_client(monkeypatch):
    class RequestError(Exception):
        def __init__(self, status, code, message):
            self.status, self.code, self.message = status, code, message
    service = types.ModuleType("api.service")
    service.RequestError = RequestError
    def unavailable(_):
        raise RequestError(429, "daily_limit", "The daily analysis limit has been reached.")
    service.analyze = unavailable
    monkeypatch.setitem(sys.modules, "api.service", service)
    response = handler.lambda_handler(request())
    assert response["statusCode"] == 429
    assert body(response)["error"] == {"code": "daily_limit", "message": "The daily analysis limit has been reached."}


@pytest.mark.parametrize("status,code,message", [(302, "upstream", "secret upstream response"), (999, "upstream", "secret upstream response"), (400, "INVALID_SOURCE_CODE", "secret upstream response"), (400, "invalid_symbol", "x" * 1025)])
def test_malformed_public_errors_fall_back_to_safe_generic_response(monkeypatch, status, code, message):
    class RequestError(Exception):
        def __init__(self):
            self.status, self.code, self.message = status, code, message
    service = types.ModuleType("api.service")
    service.RequestError = RequestError
    def invalid_error(_):
        raise RequestError()
    service.analyze = invalid_error
    monkeypatch.setitem(sys.modules, "api.service", service)
    response = handler.lambda_handler(request())
    assert response["statusCode"] == 503
    assert body(response)["error"]["code"] == "analysis_unavailable"
    assert "secret upstream response" not in response["body"]


def test_unexpected_errors_never_expose_exception_text(monkeypatch):
    def broken(_):
        raise RuntimeError("secret-token-provider-response-private-path")
    monkeypatch.setattr(handler, "_analyze", broken)
    response = handler.lambda_handler(request())
    assert response["statusCode"] == 503
    assert "secret-token" not in response["body"]
    assert body(response)["error"]["code"] == "analysis_unavailable"


@pytest.mark.parametrize("payload", [None, ["unexpected"], {"price": float("nan")}, {"unsupported": object()}, {"invalidUnicode": "\ud800"}, {"history": "x" * (256 * 1024)}, {"history": "語" * (100 * 1024)}])
def test_invalid_or_oversized_results_return_small_safe_errors(monkeypatch, payload):
    monkeypatch.setattr(handler, "_analyze", lambda _: payload)
    response = handler.lambda_handler(request())
    assert response["statusCode"] == 502
    assert len(response["body"].encode("utf-8")) < 1024
    assert "error" in body(response)
