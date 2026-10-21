"""Small HTTP adapter for a Lambda Function URL or API Gateway payload v2.

The analysis service owns caching, quotas and provider access. Health checks,
preflight requests and invalid inputs do not import that service or the scanner.
"""
from __future__ import annotations

import json
import logging
import os
import re
from urllib.parse import parse_qs

MAX_RESPONSE_BYTES = 256 * 1024
SYMBOL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,23}", re.ASCII)
PUBLIC_ERROR_CODE = re.compile(r"[a-z][a-z0-9_]{0,63}", re.ASCII)
PUBLIC_ERROR_STATUSES = {400, 404, 409, 422, 429, 500, 502, 503, 504}
LOG = logging.getLogger(__name__)


class _ApprovedError(Exception):
    def __init__(self, status, code, message):
        self.status = status
        self.code = code
        self.message = message


def _analyze(symbol):
    """Lazy service boundary, replaceable in HTTP adapter tests."""
    from .service import RequestError, analyze
    try:
        return analyze(symbol)
    except RequestError as error:
        if (type(error.status) is not int or error.status not in PUBLIC_ERROR_STATUSES
                or not isinstance(error.code, str) or not PUBLIC_ERROR_CODE.fullmatch(error.code)
                or not isinstance(error.message, str) or not 1 <= len(error.message) <= 1024):
            raise RuntimeError("Invalid public service error") from None
        raise _ApprovedError(error.status, error.code, error.message) from None


def _headers(origin):
    headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin"}
    allowed = os.environ.get("ALLOWED_ORIGIN", "").strip().rstrip("/")
    if allowed and origin == allowed:
        headers.update({
            "Access-Control-Allow-Origin": allowed,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
        })
    return headers


def _response(status, payload, origin, extra_headers=None):
    headers = _headers(origin)
    if extra_headers:
        headers.update(extra_headers)
    if status == 204:
        return {"statusCode": status, "headers": headers, "body": "", "isBase64Encoded": False}
    try:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        body.encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        status = 502
        body = json.dumps({"error": {"code": "invalid_response", "message": "The analysis service returned an invalid result. Please try again later."}})
    if len(body.encode("utf-8")) > MAX_RESPONSE_BYTES:
        status = 502
        body = json.dumps({"error": {"code": "response_too_large", "message": "The analysis result was too large to return. Please try again later."}})
    return {"statusCode": status, "headers": headers, "body": body, "isBase64Encoded": False}


def _error(status, code, message, origin, extra_headers=None):
    return _response(status, {"error": {"code": code, "message": message}}, origin, extra_headers)


def _symbol(event):
    raw = event.get("rawQueryString")
    if raw is not None and (not isinstance(raw, str) or len(raw) > 256):
        return None
    if isinstance(raw, str) and raw:
        try:
            values = parse_qs(raw, keep_blank_values=True, strict_parsing=True, max_num_fields=4).get("symbol", [])
        except ValueError:
            return None
    elif isinstance(event.get("multiValueQueryStringParameters"), dict):
        values = event["multiValueQueryStringParameters"].get("symbol", [])
    else:
        query = event.get("queryStringParameters")
        values = [query.get("symbol")] if isinstance(query, dict) and "symbol" in query else []
    if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str):
        return None
    symbol = values[0].strip()
    return symbol.upper() if SYMBOL.fullmatch(symbol) else None


def lambda_handler(event, context=None):
    if not isinstance(event, dict):
        return _error(400, "invalid_request", "A valid HTTP request is required.", "")
    headers = event.get("headers") or {}
    origin = next((value for key, value in headers.items() if isinstance(key, str) and key.lower() == "origin" and isinstance(value, str)), "") if isinstance(headers, dict) else ""
    allowed = os.environ.get("ALLOWED_ORIGIN", "").strip().rstrip("/")
    if origin and origin != allowed:
        return _error(403, "origin_not_allowed", "Requests from this website are not allowed.", origin)
    request_context = event.get("requestContext") or {}
    http = (request_context.get("http") or {}) if isinstance(request_context, dict) else {}
    if not isinstance(http, dict):
        http = {}
    method = http.get("method") or event.get("httpMethod")
    path = event.get("rawPath") or http.get("path") or event.get("path")
    if not isinstance(method, str) or not isinstance(path, str):
        return _error(400, "invalid_request", "A valid HTTP method and path are required.", origin)
    method = method.upper()
    path = path.rstrip("/") or "/"
    if path not in ("/analyze", "/health"):
        return _error(404, "not_found", "This endpoint does not exist.", origin)
    if method == "OPTIONS":
        return _response(204, None, origin)
    if method != "GET":
        return _error(405, "method_not_allowed", "Use GET for this endpoint.", origin, {"Allow": "GET, OPTIONS"})
    if path == "/health":
        return _response(200, {"status": "ok"}, origin)
    symbol = _symbol(event)
    if symbol is None:
        return _error(400, "invalid_symbol", "Enter one stock symbol using up to 24 letters, numbers, dots, dashes or underscores.", origin)
    try:
        result = _analyze(symbol)
    except _ApprovedError as error:
        return _error(error.status, error.code, error.message, origin)
    except Exception:
        # Do not expose provider responses, configuration, credentials or traces.
        LOG.warning("Stock analysis failed without a public service error")
        return _error(503, "analysis_unavailable", "The analysis could not be completed. Please try again later.", origin)
    if not isinstance(result, dict):
        return _error(502, "invalid_response", "The analysis service returned an invalid result. Please try again later.", origin)
    return _response(200, result, origin)


handler = lambda_handler
