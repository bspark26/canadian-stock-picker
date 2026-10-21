"""Optional, budget-limited AI curation of supplied evidence, without free-form facts."""
from __future__ import annotations

import hashlib
import json
import os

import requests


def http_failure(error):
    """Return fixed diagnostics, never server messages or exception/request text."""
    response = error.response
    status = response.status_code if response is not None and type(response.status_code) is int else None
    code, kind = None, None
    if response is not None:
        try:
            body = response.json()
            detail = body.get("error") if isinstance(body, dict) else None
            if isinstance(detail, dict):
                code, kind = detail.get("code"), detail.get("type")
        except (ValueError, requests.RequestException):
            pass
    allowed = {
        "invalid_api_key", "insufficient_quota", "credit_balance_exhausted",
        "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded", "rate_limit_exceeded", "slow_down",
        "model_not_found", "permission_denied", "invalid_request_error", "invalid_json_schema",
    }
    code = code if isinstance(code, str) and code in allowed else None
    label = f"HTTP {status}" if status is not None else "HTTP request failed"
    if code:
        label += f" ({code})"
    if status == 401:
        action = "Authentication failed; check the saved API key, project and endpoint permissions."
    elif status == 403:
        action = "Access denied; check key permissions, project model access and permitted region."
    elif status == 404:
        action = "Model or endpoint unavailable; check the configured model and project access."
    elif status == 429:
        billing = {"insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"}
        action = "Billing or quota limit; check API credits and project/organization limits before another attempt." if code in billing or kind == "insufficient_quota" else "Rate limit reached; wait before another manual attempt."
    elif status == 400:
        action = "Request rejected; check model parameters and structured-output schema."
    else:
        action = "API request failed; check service status before another manual attempt."
    return f"{label}. {action}"


def curate(opportunities, settings, cache, maximum):
    model = os.environ.get("OPENAI_MODEL", "gpt-6.1-sol")
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return 0, model, ["AI requested but OPENAI_API_KEY is absent; rules analysis retained."]
    spent, analyzed, warnings = 0.0, 0, []
    maximum = min(maximum, 50)
    budget = float(os.environ.get("AI_MAX_SPEND_USD", settings["ai_max_spend_usd"]))
    for opportunity in opportunities[:maximum]:
        evidence = {
            field: opportunity[field] for field in ("symbol", "currency", "financialCurrency", "price", "priceAsOf", "fundamentalsAsOf", "fundamentals", "technicals", "reasons", "risks")
        }
        # The model can reorder existing evidence, never author unsupported financial facts.
        prompt = "Select the most decision-relevant supplied evidence for a personal Canadian stock research summary. Return indices only. Do not infer management, projects, drilling, debt, solvency, expected returns, or option availability. Prefer recent, comparable evidence and acknowledge data gaps. Select 1-3 reason indices and 1-3 risk indices from these arrays. Evidence: " + json.dumps(evidence, allow_nan=False)
        digest = hashlib.sha256((model + prompt).encode()).hexdigest()
        result = cache.get("ai", digest, 24 * 30)
        if not result:
            max_output = min(int(settings["ai_max_output_tokens"]), 1200)
            # UTF-8 byte count conservatively overestimates ordinary JSON input tokens.
            estimate = (len(prompt.encode()) + 1024) * settings["ai_input_usd_per_million"] / 1_000_000 + max_output * settings["ai_output_usd_per_million"] / 1_000_000
            if spent + estimate > budget:
                warnings.append("AI stopped at the configured estimated per-run spend limit; remaining analysis uses rules.")
                break
            schema = {"type": "object", "properties": {field: {"type": "array", "items": {"type": "integer"}, "minItems": 1, "maxItems": 3} for field in ("reasonIndexes", "riskIndexes")}, "required": ["reasonIndexes", "riskIndexes"], "additionalProperties": False}
            try:
                request_body = {"model": model, "input": prompt, "max_output_tokens": max_output, "text": {"format": {"type": "json_schema", "name": "evidence_selection", "strict": True, "schema": schema}}}
                if model == "gpt-6.1-sol":
                    request_body["reasoning"] = {"effort": "low"}
                # Reserve before transmission: a timed-out request can still be billed.
                spent += estimate
                response = requests.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=request_body, timeout=45)
                # Never retry a potentially billed generation automatically.
                response.raise_for_status()
                body = response.json()
                if not isinstance(body, dict) or body.get("status") != "completed":
                    raise ValueError("Incomplete model response")
                output = body.get("output")
                if not isinstance(output, list) or any(not isinstance(item, dict) or not isinstance(item.get("content", []), list) for item in output):
                    raise ValueError("Malformed model output")
                parts = [part for item in output for part in item.get("content", [])]
                if any(not isinstance(part, dict) for part in parts):
                    raise ValueError("Malformed model content")
                content = "".join(part.get("text", "") for part in parts if part.get("type") == "output_text")
                result = json.loads(content)
                for key_name, source in (("reasonIndexes", opportunity["reasons"]), ("riskIndexes", opportunity["risks"])):
                    indices = result[key_name]
                    if not 1 <= len(indices) <= 3 or any(type(index) is not int or not 0 <= index < len(source) for index in indices):
                        raise ValueError("Invalid evidence indices")
                cache.put("ai", digest, result)
            except requests.HTTPError as error:
                warnings.append(f"AI curation failed for {opportunity['symbol']}: {http_failure(error)} Rules analysis retained.")
                continue
            except requests.Timeout:
                warnings.append(f"AI curation timed out for {opportunity['symbol']}; the attempt may still be billed. No automatic retry; rules analysis retained.")
                continue
            except requests.ConnectionError:
                warnings.append(f"AI connection failed for {opportunity['symbol']}; no automatic retry; rules analysis retained.")
                continue
            except (requests.RequestException, ValueError, KeyError, TypeError):
                warnings.append(f"AI curation failed for {opportunity['symbol']}; rules analysis retained.")
                continue
        selected = list(dict.fromkeys(result["reasonIndexes"]))
        chosen = [opportunity["reasons"][index] for index in selected]
        opportunity["summary"] = " ".join(chosen)
        opportunity["reasons"] = chosen + [value for index, value in enumerate(opportunity["reasons"]) if index not in selected]
        selected_risks = list(dict.fromkeys(result["riskIndexes"]))
        opportunity["risks"] = [opportunity["risks"][index] for index in selected_risks] + [value for index, value in enumerate(opportunity["risks"]) if index not in selected_risks]
        opportunity["analysisKind"] = "AI"
        analyzed += 1
    if spent:
        warnings.append(f"AI request budget reserved approximately US${spent:.4f}; this is an estimate using configured model rates, not a billing record.")
    return analyzed, model, warnings
