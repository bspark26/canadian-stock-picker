import { date, isNumber, money, number, percent } from './format';
import type { TradePlan as Plan } from './types';
import { plainEnglish } from './plainEnglish';

export function EntryScenarioCell({ plan, currency }: { plan?: Plan; currency: string }) {
  const available = plan && plan.status !== 'Unavailable';
  return <div className="entry-scenario-cell"><strong>{available ? `${money(plan.entryLow, currency)} – ${money(plan.entryHigh, currency)}` : '—'}</strong><span>{!plan ? 'No buy price yet' : plan.status === 'Unavailable' ? 'No suitable buy price' : plan.status === 'Wait' ? 'Wait for this price range' : 'Last close was in this range'}</span></div>;
}

export function UpsideScenarioCell({ plan, demo }: { plan?: Plan; demo: boolean }) {
  const available = plan && plan.status !== 'Unavailable';
  const estimated = !demo && available && plan.probability.status === 'Estimated' && isNumber(plan.probability.value);
  return <><div className="upside-scenario-cell"><strong>{available ? percent(plan.upsidePercent, true) : '—'}</strong><span>{available ? 'if target is reached' : 'No estimate yet'}</span></div>{estimated && <div className="table-probability"><strong>{number(plan.probability.value)}%</strong><span>chance of reaching target</span></div>}</>;
}

export default function TradePlan({ plan, currency, demo }: { plan?: Plan; currency: string; demo: boolean }) {
  const available = plan && plan.status !== 'Unavailable';
  const sessions = plan?.horizonSessions || 20;
  const validFor = plan?.entryValidForSessions || 5;
  const history = !demo && plan?.historical?.method.trim() && plan.historical.asOf
    && !/synthetic|demo|illustrative/i.test(plan.historical.method) ? plan.historical : null;
  const probability = plan?.probability;
  const estimated = !demo && available && probability?.status === 'Estimated' && isNumber(probability.value);
  const validation = estimated ? probability.validation : null;
  const status = !plan || plan.status === 'Unavailable' ? 'No suitable buy price' : plan.status === 'Wait' ? 'Wait for buy range' : 'In buy range at close';
  return <section className="trade-plan-section" aria-labelledby="trade-plan-title">
    <div className="trade-plan-heading"><h3 id="trade-plan-title">Buy and sell plan</h3><span className={`pill ${plan?.status === 'Ready' ? 'green' : plan?.status === 'Wait' ? 'amber' : 'neutral'}`}>{status}</span></div>
    <div className="trade-plan-grid">
      <section className="entry-plan-card">
        <div className="entry-zone-label">Suggested buy range <small>{currency}</small></div>
        <div className="entry-zone-value">{available ? <>{money(plan.entryLow, currency)}<span>–</span>{money(plan.entryHigh, currency)}</> : '—'}</div>
        <div className="entry-reference">Buy price used <strong>{available ? money(plan.referenceEntry, currency) : '—'}</strong>{plan && <span>{date(plan.asOf, true)}</span>}</div>
        <div className="scenario-levels"><div><div><span>Target sell price</span><strong>{available ? money(plan.target, currency) : '—'}</strong></div><span className="scenario-return positive">{available ? percent(plan.upsidePercent, true) : '—'}</span></div><div><div><span>Sell if it falls to</span><strong>{available ? money(plan.invalidation, currency) : '—'}</strong></div><span className="scenario-return negative">{available ? percent(plan.downsidePercent, true) : '—'}</span></div></div>
        <div className="reward-risk-row"><span>Possible gain vs loss at highest buy price</span><strong>{available && isNumber(plan.rewardRisk) ? `${number(plan.rewardRisk, 2)} : 1` : '—'}</strong></div>
        <p className="plan-timing">Time allowed to reach the target: <strong>{number(sessions)} trading days after buying.</strong> The buy range applies for <strong>{number(validFor)} trading days</strong> after {plan ? date(plan.asOf, true) : 'the date of this plan'}.</p>
        {available ? <p className="plan-return-basis">The gain and loss percentages use the buy price shown above. Fees and differences in the actual trading price are not included.</p> : <p className="plan-unavailable">{plainEnglish(plan?.explanation || 'No suitable buy price in these results.')}</p>}
      </section>
      <section className={`probability-card${estimated ? ' probability-estimated' : ''}`} aria-labelledby="probability-title">
        <h4 id="probability-title">Chance of reaching target</h4>
        <strong className="probability-value">{estimated ? `${number(probability.value)}%` : 'No estimate yet'}</strong>
        {estimated ? <p className="probability-lead">Estimated chance, assuming you buy at {money(plan.referenceEntry, currency)}.</p> : <p className="probability-lead">{demo ? 'Example data cannot provide a real chance estimate.' : plainEnglish(probability?.reason || 'There is not enough supporting data yet.')}</p>}
        <p className="probability-event-text">{available ? <>Reaches {money(plan.target, currency)} before falling to {money(plan.invalidation, currency)}, within {number(sessions)} trading days after buying.</> : 'A target price and a lower exit price are needed before a chance can be estimated.'}</p>
        {estimated && validation && <p className="probability-sample-line">Tested on {number(validation.testSamples)} past examples across {number(validation.testSymbols)} stocks<br />Estimate updated: {date(probability.asOf, true)}</p>}
        {estimated && validation && <details className="validation-details"><summary>How this chance was estimated</summary><dl>
          <div><dt>Model version</dt><dd>{probability.modelVersion}</dd></div>
          <div><dt>Dates used for testing</dt><dd>{date(validation.testStart, true)} – {date(validation.testEnd, true)}</dd></div>
          <div><dt>Prediction error / simple comparison</dt><dd>{number(validation.brier, 3)} / {number(validation.baselineBrier, 3)}</dd></div>
          <div><dt>Average gap from test results</dt><dd>{number(validation.calibrationError * 100, 1)} percentage points</dd></div>
          {isNumber(validation.setupSamples) && <div><dt>Tests with this price pattern</dt><dd>{number(validation.setupSamples)}</dd></div>}
          {isNumber(validation.binSamples) && <div><dt>Tests with similar chance estimates</dt><dd>{number(validation.binSamples)}</dd></div>}
          {isNumber(validation.observedHitRatePercent) && <div><dt>Target reached first in those tests</dt><dd>{percent(validation.observedHitRatePercent)}</dd></div>}
        </dl><p>{plainEnglish(probability.reason)}</p><p>Lower prediction error is better. The comparison simply uses how often the target was reached in past examples.</p><p>The test assumes a buy order at the price shown. It skips the trade if the market opens at or below the lower exit price. A different buy price needs a new estimate. This is not the chance of making a profit after trading costs.</p></details>}
      </section>
    </div>
    {available && <details className="plan-rules"><summary>How these prices were chosen</summary><strong>{plainEnglish(plan.basis)}</strong><p>{plainEnglish(plan.explanation)}</p><p>The gain-to-loss comparison uses the highest price in the buy range. The actual price you buy or sell at can differ, especially if the market opens below the lower exit price.</p></details>}
    {history && <details className="historical-evidence"><summary>Similar past plans · {number(history.samples)} simulated buys</summary><div className="historical-evidence-content"><div className="historical-counts"><div><span>Reached target first</span><strong>{number(history.targetFirst)}</strong></div><div><span>Fell to exit price first</span><strong>{number(history.stopFirst)}</strong></div><div><span>Neither within the time limit</span><strong>{number(history.expired)}</strong></div><div><span>Buy order was not filled</span><strong>{number(history.unfilled)}</strong></div><div><span>Order of price moves was unclear</span><strong>{number(history.ambiguous)}</strong></div></div><div className="historical-method"><span>Through {date(history.asOf, true)}</span><span>Earlier plans for this stock were replayed using only prices known at the time, with one plan active at a time. Buy orders had five trading days to fill, followed by 20 trading days of price checks. Only examples with a complete follow-up were counted. When daily prices leave the order of events unclear, the test uses the less favourable result. These results exclude trading costs and do not predict this trade.</span></div></div></details>}
  </section>;
}
