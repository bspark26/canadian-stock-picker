"""Statement-derived financial evidence, kept in the issuer's reporting currency."""
from __future__ import annotations

from datetime import date
from .technicals import number

FIELDS = ("cash", "debt", "revenueGrowth", "freeCashFlow", "operatingCashFlow", "cashRunwayMonths", "profitMargin", "priceToSales")


def evaluate(payload: dict, today: date | None = None):
    today = today or date.today()
    info = payload.get("info", {})
    balance, flow, income = (payload.get(key, {}) for key in ("balance", "cashflow", "income"))
    output = {key: None for key in FIELDS}
    risks, reasons = [], []
    cash = number(balance.get("cash"))
    debt = number(balance.get("debt"))
    output.update(cash=cash, debt=debt)
    # Yahoo fractions are converted to display percentages exactly once.
    for source, target in (("revenueGrowth", "revenueGrowth"), ("profitMargins", "profitMargin")):
        value = number(info.get(source))
        output[target] = round(value * 100, 3) if value is not None else None
    # Vendor-supplied ratio; do not derive it from mixed quote/reporting currencies.
    output["priceToSales"] = number(info.get("priceToSalesTrailing12Months"))
    annual = flow.get("period") == "12M"
    if annual:
        output["operatingCashFlow"] = number(flow.get("operatingCashFlow"))
        output["freeCashFlow"] = number(flow.get("freeCashFlow"))
    cash_date, flow_date = balance.get("asOf"), flow.get("asOf")
    dates = [value for value in (cash_date, flow_date, income.get("asOf")) if value]
    as_of = min(dates) if dates else None
    fresh_flow = False
    if cash_date and flow_date:
        try:
            age = (today - date.fromisoformat(flow_date)).days
            alignment = (date.fromisoformat(cash_date) - date.fromisoformat(flow_date)).days
            fresh_flow = 0 <= age <= 540 and 0 <= alignment <= 366 and date.fromisoformat(cash_date) <= today
        except ValueError:
            pass
    operating = output["operatingCashFlow"]
    if cash is not None and cash >= 0 and operating is not None and operating < 0 and annual and fresh_flow:
        output["cashRunwayMonths"] = round(cash / -operating * 12, 1)
        reasons.append(f"Cash runway from reported annual operating cash burn: approximately {output['cashRunwayMonths']:g} months.")
        risks.append("Operating-burn runway is backward-looking; construction, growth capital, debt maturities and future financing are excluded.")
    elif operating is not None and operating < 0:
        risks.append("Negative annual operating cash flow; comparable, sufficiently recent cash and cash-flow periods are required to estimate runway.")
    sector = info.get("sector", "Unknown")
    revenue = number(income.get("revenue"))
    prerevenue = sector == "Basic Materials" and revenue is not None and revenue <= 0
    specialist = sector in ("Financial Services", "Real Estate")
    if prerevenue:
        reasons.append("No revenue in the supplied annual resource-company income statement; review current development/production status. Absent annual revenue is not itself a failure.")
        risks.append("Project economics, drill results, management quality and development funding have not been independently verified.")
    if specialist:
        risks.append("Generic cash-flow/debt scoring is withheld for financial and real-estate companies; sector-specific measures need review.")
    components = []
    if not specialist:
        if cash is not None and debt is not None and cash >= 0 and debt >= 0:
            if debt == 0:
                components.append(80 if cash > 0 else 40)
            else:
                components.append(min(80, max(20, 50 + (cash / debt - 1) * 20)))
            reasons.append("Reported cash exceeds interest-bearing debt." if cash > debt else "Reported interest-bearing debt is at least as large as cash.")
        if not prerevenue:
            growth, margin, fcf = (output[key] for key in ("revenueGrowth", "profitMargin", "freeCashFlow"))
            if growth is not None:
                components.append(min(80, max(20, 50 + growth)))
            if margin is not None:
                components.append(min(80, max(20, 50 + margin * 1.5)))
            generation = [75 if value > 0 else 25 if value < 0 else 40 for value in (operating, fcf) if value is not None]
            if generation:
                # Operating/free cash flow are correlated, so they form one evidence category.
                components.append(sum(generation) / len(generation))
        else:
            runway = output["cashRunwayMonths"]
            if runway is not None:
                components.append(min(80, max(20, runway * 2.5)))
    # At least three independent signals are needed; pre-revenue names often stay unscored.
    score = round(sum(components) / len(components)) if len(components) >= 3 else None
    if score is None:
        risks.append("Insufficient comparable fundamental evidence for a score.")
    if as_of is None:
        risks.append("Financial reporting period unavailable; verify current issuer filings.")
    elif (today - date.fromisoformat(as_of)).days > 450:
        risks.append("Some financial evidence is over 450 days old.")
        score = None
        risks.append("Fundamental score withheld because statement evidence is stale.")
    if any(date.fromisoformat(value) > today for value in dates):
        score = None
        output["cashRunwayMonths"] = None
        risks.append("A financial period is in the future; score and runway withheld pending source verification.")
    currency = info.get("financialCurrency") or None
    if not currency and any(output[key] is not None for key in ("cash", "debt", "freeCashFlow", "operatingCashFlow")):
        risks.append("Financial reporting currency is unknown.")
    meaningful_keys = ["cash", "debt", "freeCashFlow", "operatingCashFlow"]
    if not prerevenue:
        meaningful_keys.extend(["revenueGrowth", "profitMargin", "priceToSales"])
    if any(output[key] is None for key in meaningful_keys):
        risks.append("Some financial metrics are unavailable; missing values are not zero.")
    return output, score, reasons, risks, as_of, currency
