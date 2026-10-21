/** Display wording only. Saved data, calculations and model rules stay unchanged. */
const phrases: readonly (readonly [string, string])[] = [
  ['Reported cash exceeds interest-bearing debt.', 'The company reports more cash than debt.'],
  ['Reported interest-bearing debt is at least as large as cash.', 'The company reports at least as much debt as cash.'],
  ['No revenue in the supplied annual resource-company income statement; review current development/production status. Absent annual revenue is not itself a failure.', 'The latest annual report shows no sales. For a mining company, check whether its projects have started producing; no sales alone does not mean the business is failing.'],
  ['Operating-burn runway is backward-looking; construction, growth capital, debt maturities and future financing are excluded.', 'The cash estimate uses past spending. It leaves out mine construction, expansion, debt repayments and future fundraising.'],
  ['Negative annual operating cash flow; comparable, sufficiently recent cash and cash-flow periods are required to estimate runway.', 'The business spent more cash than it brought in. There is not enough recent, matching financial data to estimate how long its cash could last.'],
  ['Generic cash-flow/debt scoring is withheld for financial and real-estate companies; sector-specific measures need review.', 'Banks, finance companies and property businesses need different financial checks, so this app does not give them a general financial score.'],
  ['Project economics, drill results, management quality and development funding have not been independently verified.', 'Project costs, drill results, management experience and construction funding still need to be checked.'],
  ['Insufficient comparable fundamental evidence for a score.', 'There is not enough comparable financial data to give a score.'],
  ['Financial reporting period unavailable; verify current issuer filings.', 'The date of the financial data is missing. Check the company’s latest reports.'],
  ['Financial reporting currency is unknown.', 'The currency used in the company’s accounts is missing.'],
  ['Fundamental score withheld because statement evidence is stale.', 'The financial reports are too old to give a useful score.'],
  ['Some financial evidence is over 450 days old.', 'Some financial data is more than 450 days old.'],
  ['Some financial metrics are unavailable; missing values are not zero.', 'Some financial numbers are missing. A blank does not mean zero.'],
  ['Fewer than 200 daily bars; long-term trend evidence is incomplete.', 'Fewer than 200 trading days of prices are available, so the long-term trend is less clear.'],
  ['Thin or unverified liquidity: quoted prices may not be executable without material spreads or slippage.', 'Trading may be light. The price you can buy or sell at could differ noticeably from the displayed price.'],
  ['Historical price ranges are descriptive; verify current quotes, corporate actions and issuer filings before acting.', 'These prices describe past trading. Check today’s quote, stock splits and company reports before trading.'],
  ['Limited available evidence: inspect the linked price history and issuer disclosures.', 'Little data is available. Check the price history and company reports in the links below.'],
  ['Fundamental retrieval was unavailable or intentionally limited; this row has technical evidence only.', 'Financial data was not collected for this stock. This row uses price data only.'],
  ['Probability withheld: completed daily OHLCV history failed validation or does not match this price timestamp.', 'No chance estimate is shown because the price history contains errors or does not match the displayed price and date.'],
  ['A valid 20-session entry/target/invalidation scenario is required.', 'A suitable buy price, target and stop price are needed before a chance can be estimated.'],
  ['A C$1 minimum price and at least C$50,000 average daily traded value are required for probability support.', 'Chance estimates require a price of at least C$1 and average daily trading of at least C$50,000.'],
  ["At least 200 completed daily bars and an available positive 200-session average are required to match the model's training history.", 'At least 200 trading days of usable prices are needed for a chance estimate.'],
  ['Completed daily OHLCV history failed validation; invalid price ranges cannot support this probability model.', 'The price history contains errors, so no chance estimate is shown.'],
  ['No validated probability artifact is available.', 'A tested prediction model is not available yet.'],
  ['No out-of-sample calibrated model has validated this event. Screening scores and historical hit rates are not forecast probabilities.', 'There is no independently tested chance estimate for this plan. Scores and past success rates are different from a prediction.'],
  ['The probability artifact is incomplete.', 'The saved prediction model is incomplete, so no chance estimate is shown.'],
  ['The probability artifact contains invalid coefficients or support metadata.', 'The saved prediction model failed its checks, so no chance estimate is shown.'],
  ['The probability artifact contains invalid validation metadata.', 'The saved prediction model has invalid test results, so no chance estimate is shown.'],
  ['The probability model is stale or its dates cannot be verified.', 'The prediction model is too old, or its dates could not be checked.'],
  ['Validation uses outcomes after this signal; a historical prediction would leak future information.', 'The test results include later prices that were not known on this plan’s date, so they cannot support an estimate for it.'],
  ['The held-out validation period is stale; fresh model training alone cannot refresh old evidence.', 'The independent test results are too old. Newer tests are needed before showing a chance estimate.'],
  ['This setup class has fewer than 75 untouched-test events.', 'Fewer than 75 comparable past setups were available in the independent test.'],
  ['This setup class has excessive held-out calibration error.', 'The estimates for this price pattern did not match past test results closely enough.'],
  ['This probability band has fewer than 50 untouched-test events.', 'Fewer than 50 past test results support this range of estimates.'],
  ['This probability band has excessive held-out calibration error.', 'Estimates in this range did not match past test results closely enough.'],
  ['Too many current technical features are unavailable.', 'Too much of the price data needed for an estimate is missing.'],
  ['Conditional technical scenario', 'Plan based on past prices'],
  ['A supported technical entry setup is not available.', 'The price pattern does not suggest a suitable buy price yet.'],
  ['The last close must be at least C$1 for an entry scenario.', 'The closing price must be at least C$1 to suggest a buy price.'],
  ['This is a research watch. Company valuation and project evidence are needed before proposing an entry.', 'No buy price is suggested yet. Take a closer look at the company’s value and projects first.'],
  ['Historical range, positive ATR and a 50-session average are required to form a timing scenario.', 'There is not enough recent price history and price movement to suggest a buy price.'],
  ['The historical range is invalid or its support has already broken at the last close.', 'The recent price range is unusable, or the stock has already fallen below its recent low.'],
  ['Rounded entry, target and invalidation prices do not leave a valid positive-risk trade structure.', 'The buy, target and stop prices are too close or in the wrong order to suggest a trade.'],
  ['The historical target leaves less than 1.5× reward/risk at the upper entry price; no entry recommendation is made.', 'At the highest suggested buy price, the possible gain is less than 1.5 times the possible loss. No buy price is suggested.'],
  ['Prior range-high retest; ATR-derived target scenario', 'Buy after a dip toward the previous high'],
  ['Prior 20-session range; ATR-buffered entry and invalidation', 'Based on the last 20 trading days and normal price swings'],
  ['After the observed breakout, wait for a retest of the prior range high. The target is a three-ATR scenario, not a valuation or a predicted future price.', 'The stock rose above its recent high. This plan waits for a dip back toward that level. The target uses three times its average daily price movement; it is a possible outcome, not a company valuation.'],
  ['Consider a pullback near the preceding 20-session range low, with the prior range high as a conditional target.', 'This plan looks for a buy near the lowest price of the previous 20 trading days, with their highest price as the target.'],
  ['Entry is conditional for the next five sessions; skip an opening gap at or below invalidation and reassess if the setup changes.', 'The suggested buy price applies for the next five trading days. Skip the trade if the market opens at or below the stop price, and review the plan if the price pattern changes.'],
  ['Estimated target-before-invalidation chance conditional on the model\'s reference-entry buy-limit fill, skipping opening gaps at or below invalidation. A different entry price requires a new estimate. Held-out historical validation does not guarantee this trade or future market conditions.', 'The estimate assumes you buy at the example buy price. Skip the trade if the market opens at or below the stop price. A different buy price needs a new estimate. Past test results do not guarantee what happens next.'],
  ['Preset chronological validation gates passed; estimates remain conditional on the supplied universe and execution assumptions.', 'The model passed its planned checks on later price data that was kept separate from training. Its estimates still depend on the stocks and buying rules used in those tests.'],
  ['Unofficial Yahoo/yfinance data is for personal research; data, adjustments and financial fields can be incomplete or erroneous. Scores are transparent heuristics, not forecasts or trade instructions.', 'Yahoo data can be missing or wrong. Scores help compare stocks; they are not predictions or instructions to trade.'],
  ['Fundamental evidence mixes the labelled annual cash-flow period with the latest balance sheet and vendor ratios; fundamentalsAsOf is the oldest statement period used. It is not the filing publication date.', 'Financial numbers combine annual cash-flow data, the latest balance sheet and Yahoo’s ratios. The financial date is the oldest reporting period used, not the date the report was released.'],
  ["Yahoo's equity classification can include preferred shares, funds and CDRs; instrument types have not been reconciled to exchange directories.", 'Yahoo’s stock list can also include preferred shares, funds and Canadian receipts for foreign shares. These types have not been checked against official exchange lists.'],
  ['Coverage is unverified against official exchange directories; Yahoo may omit listings or retain stale/ineligible securities.', 'The results have not been compared with official exchange lists. Yahoo may miss stocks or include old listings that no longer trade.'],
  ['Explicit --symbols smoke-test scope; this is not a whole-market scan.', 'This test checked only the selected stock symbols, not the whole market.'],
  ['Deterministic round robin by present-day exchange and sector, ordered by provider dollar-volume proxy within each group. Not a whole-market backtest.', 'Stocks were sampled from today’s exchange and sector lists, with more actively traded stocks considered first within each group. The test did not cover the entire market.'],
  ["Pilot based on today's Yahoo Canadian equity directory, not a historical constituent master. Delisted/missing listings and survivorship bias are not resolved. Technical price-only event estimates; no historical fundamentals, trading-cost profitability, intraday ordering certainty or future return guarantee. Reported stock splits restart the usable history; unexplained extreme price jumps are rejected.", 'This first model uses stocks in Yahoo’s current Canadian listings. Companies that disappeared or are missing from Yahoo are not fully represented. It uses past prices, not past financial reports. It does not include trading costs, cannot always tell which price was reached first within a day, and cannot guarantee future returns. History starts again after a reported stock split, and unexplained large price jumps are excluded.'],
];

const featureLabels: Record<string, string> = {
  rewardRisk: 'possible gain compared with possible loss',
  targetAtr: 'target price compared with normal daily price swings',
  stopAtr: 'lower exit price compared with normal daily price swings',
  rsi14: 'recent price strength',
  distanceSma50Atr: 'distance from the 50-day average price',
  return20d: 'price change over 20 trading days',
  relativeVolume: 'trading volume compared with usual',
  logDollarVolume: 'average daily amount traded',
};

export function plainEnglish(text: string): string {
  let result = text;
  for (const [original, replacement] of phrases) result = result.replaceAll(original, replacement);
  return result
    .replace(/Daily close is (above|below) its 50-session average\./g, 'The closing price is $1 its average over the last 50 trading days.')
    .replace(/20-session price change:/g, 'Price change over 20 trading days:')
    .replace(/14-session RSI: ([\d.]+); descriptive momentum, not a reversal prediction\./g, 'Recent price momentum (14-day RSI): $1. This describes recent movement; it does not predict a change in direction.')
    .replace(/Cash runway from reported annual operating cash burn: approximately ([\d.]+) months\./g, 'At the past rate of cash used to run the business, reported cash could last about $1 months.')
    .replace(/The latest available daily bar is (\d+) days old\./g, 'The latest daily price is $1 days old.')
    .replace(/Current entryDistanceAtr is outside the model's historical feature support\./g, 'The gap between today’s price and the suggested buy price differs too much from the past examples used by this model.')
    .replace(/Current (\w+) is outside the model's historical feature support\./g, (_, feature: string) => featureLabels[feature]
      ? `The ${featureLabels[feature]} is outside the range covered by past examples, so no chance estimate is shown.`
      : 'Current trading conditions differ too much from the past examples used by this model.')
    .replace(/(TSX|TSXV|CSE|Cboe Canada): discovered (\d+) of Yahoo-reported (\d+); pagination incomplete\./g, '$1: loaded $2 of $3 Yahoo listings. Some listings could not be loaded.')
    .replace(/Yahoo exchange totals \(not reconciled to exchange issuer directories\):/g, 'Listings loaded / listings reported by Yahoo (not checked against official exchange lists):')
    .replace(/Excluded (\d+) identified CDR\/CAD-hedged listings by name; classification is not exhaustive\. Config exclude_cdrs can disable this filter\./g, 'Skipped $1 listings identified by name as Canadian receipts for foreign shares or currency-hedged shares. This name check may miss some.')
    .replace(/Excluded (\d+) non-CAD or unknown-currency listings; no FX conversion is inferred\./g, 'Skipped $1 listings priced in another currency or with no confirmed currency. Prices were not converted to Canadian dollars.')
    .replace(/Daily history failed for (\d+) listings; coverage is partial\./g, 'Daily prices could not be loaded for $1 listings, so the results do not cover the whole list.')
    .replace(/Excluded (\d+) listings with future, insufficient or stale daily history \(latest bar over 7 calendar days old\); suspended\/delisted prices are not active candidates\./g, 'Skipped $1 listings with too little price history, future-dated prices or prices more than 7 days old. Stocks that stopped trading are not treated as current opportunities.')
    .replace(/Excluded (\d+) listings with invalid completed daily OHLCV histories; no technical scores or entry scenarios were published for them\./g, 'Skipped $1 listings with errors in their daily prices or trading volume. No price score or buy plan was shown for them.')
    .replace(/Showing the top (\d+) research candidates from (\d+) eligible listings; this is a display shortlist, not the entire universe\./g, 'Showing $1 top-ranked matches from $2 listings that passed the filters.')
    .replace(/\buntouched-test (events|observations)\b/g, 'independent test examples')
    .replace(/\bheld-out\b/g, 'independent test')
    .replace(/\bprobability artifact\b/g, 'saved prediction model')
    .replace(/\btrading sessions\b/g, 'trading days')
    .replace(/\bissuer filings\b/g, 'company reports');
}
