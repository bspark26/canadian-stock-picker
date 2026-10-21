"""Optional, budget-limited AI curation of supplied evidence, without free-form facts."""
from __future__ import annotations

import hashlib
import json
import os

import requests


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
                if body.get("status") != "completed":
                    raise ValueError("Incomplete model response")
                content = "".join(part.get("text", "") for item in body.get("output", []) for part in item.get("content", []) if part.get("type") == "output_text")
                result = json.loads(content)
                for key_name, source in (("reasonIndexes", opportunity["reasons"]), ("riskIndexes", opportunity["risks"])):
                    indices = result[key_name]
                    if not 1 <= len(indices) <= 3 or any(type(index) is not int or not 0 <= index < len(source) for index in indices):
                        raise ValueError("Invalid evidence indices")
                cache.put("ai", digest, result)
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
