import copy

import pytest
import requests

from scanner.ai import curate


FAKE_KEY = "sk-proj-" + "fake_secret_for_error_redaction_test" * 2
SETTINGS = {"ai_max_spend_usd": 0.05, "ai_max_output_tokens": 1000, "ai_input_usd_per_million": 2, "ai_output_usd_per_million": 10}
FIXTURE = {"symbol": "DEMO.TO", "currency": "CAD", "financialCurrency": "CAD", "price": 20,
           "priceAsOf": "2026-10-20", "fundamentalsAsOf": "2025-12-31", "fundamentals": {}, "technicals": {},
           "reasons": ["Synthetic supplied evidence."], "risks": ["Illustrative fixture only."], "analysisKind": "Rules"}


class EmptyCache:
    def get(self, *_):
        return None

    def put(self, *_):
        raise AssertionError("A failed request must not be cached")


class ErrorResponse:
    def __init__(self, status, code=None, kind=None, malformed=False):
        self.status_code, self.code, self.kind, self.malformed = status, code, kind, malformed

    def __bool__(self):
        # requests.Response is also false for HTTP error statuses.
        return False

    def json(self):
        if self.malformed:
            raise ValueError(f"malicious malformed JSON: {FAKE_KEY}")
        return {"error": {"code": self.code, "type": self.kind, "message": f"malicious server text: {FAKE_KEY}"}}

    def raise_for_status(self):
        raise requests.HTTPError(f"malicious exception text: {FAKE_KEY}", response=self)


@pytest.mark.parametrize("status,code,kind,expected", [
    (401, "invalid_api_key", None, "Authentication failed"),
    (403, "permission_denied", None, "Access denied"),
    (429, "credit_balance_exhausted", "insufficient_quota", "Billing or quota limit"),
    (429, "project_spend_limit_exceeded", "insufficient_quota", "Billing or quota limit"),
    (429, "rate_limit_exceeded", "rate_limit_error", "Rate limit reached"),
    (404, "model_not_found", None, "Model or endpoint unavailable"),
    (400, "invalid_json_schema", None, "structured-output schema"),
])
def test_http_failures_are_actionable_sanitized_and_never_retried(monkeypatch, status, code, kind, expected):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-6.1-sol")
    monkeypatch.setenv("AI_MAX_SPEND_USD", "0.05")
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        return ErrorResponse(status, code, kind)

    monkeypatch.setattr("scanner.ai.requests.post", post)
    fixture = copy.deepcopy(FIXTURE)
    analyzed, model, warnings = curate([fixture], SETTINGS, EmptyCache(), 1)
    text = " ".join(warnings)
    assert analyzed == 0 and model == "gpt-6.1-sol"
    assert fixture["analysisKind"] == "Rules"
    assert calls == ["https://api.openai.com/v1/responses"]
    assert f"HTTP {status}" in text and code in text and expected in text
    assert FAKE_KEY not in text and "malicious" not in text


@pytest.mark.parametrize("code,malformed", [(FAKE_KEY, False), (None, True)])
def test_unknown_or_malformed_server_details_cannot_leak(monkeypatch, code, malformed):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    monkeypatch.setattr("scanner.ai.requests.post", lambda *a, **k: ErrorResponse(429, code, malformed=malformed))
    analyzed, _, warnings = curate([copy.deepcopy(FIXTURE)], SETTINGS, EmptyCache(), 1)
    text = " ".join(warnings)
    assert analyzed == 0 and "HTTP 429" in text
    assert FAKE_KEY not in text and "malicious" not in text


@pytest.mark.parametrize("failure,label", [(requests.Timeout, "timed out"), (requests.ConnectionError, "connection failed")])
def test_network_failure_does_not_log_exception_or_retry(monkeypatch, failure, label):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    attempts = []

    def post(*args, **kwargs):
        attempts.append(1)
        raise failure(f"malicious network exception: {FAKE_KEY}")

    monkeypatch.setattr("scanner.ai.requests.post", post)
    analyzed, _, warnings = curate([copy.deepcopy(FIXTURE)], SETTINGS, EmptyCache(), 1)
    text = " ".join(warnings)
    assert analyzed == 0 and label in text and "No automatic retry" in text.replace("no automatic retry", "No automatic retry")
    assert len(attempts) == 1
    assert FAKE_KEY not in text and "malicious" not in text


@pytest.mark.parametrize("body", [[], {"status": "completed", "output": [FAKE_KEY]}, {"status": "completed", "output": [{"content": [FAKE_KEY]}]}])
def test_malformed_success_body_falls_back_without_server_content(monkeypatch, body):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return body

    monkeypatch.setattr("scanner.ai.requests.post", lambda *a, **k: Response())
    analyzed, _, warnings = curate([copy.deepcopy(FIXTURE)], SETTINGS, EmptyCache(), 1)
    text = " ".join(warnings)
    assert analyzed == 0 and "rules analysis retained" in text
    assert FAKE_KEY not in text
