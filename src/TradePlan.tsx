import { date, isNumber, money, number, percent } from './format';
import type { TradePlan as Plan } from './types';

export function EntryScenarioCell({ plan, currency }: { plan?: Plan; currency: string }) {
  const available = plan && plan.status !== 'Unavailable';
  return <div className="entry-scenario-cell"><strong>{available ? `${money(plan.entryLow, currency)} – ${money(plan.entryHigh, currency)}` : '—'}</strong><span>{!plan ? 'No plan' : plan.status === 'Unavailable' ? 'No qualifying setup' : plan.status === 'Wait' ? 'Wait for entry' : 'Entry zone'}</span></div>;
}

export function UpsideScenarioCell({ plan, demo }: { plan?: Plan; demo: boolean }) {
  const available = plan && plan.status !== 'Unavailable';
  const estimated = !demo && available && plan.probability.status === 'Estimated' && isNumber(plan.probability.value);
  return <><div className="upside-scenario-cell"><strong>{available ? percent(plan.upsidePercent, true) : '—'}</strong><span>{available ? 'target scenario' : 'Not estimated'}</span></div>{estimated && <div className="table-probability"><strong>{number(plan.probability.value)}%</strong><span>target before stop</span></div>}</>;
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
  const status = !plan || plan.status === 'Unavailable' ? 'No qualifying setup' : plan.status === 'Wait' ? 'Wait for entry' : 'Entry zone reached at last close';
  return <section className="trade-plan-section" aria-labelledby="trade-plan-title">
    <div className="trade-plan-heading"><h3 id="trade-plan-title">Trade plan</h3><span className={`pill ${plan?.status === 'Ready' ? 'green' : plan?.status === 'Wait' ? 'amber' : 'neutral'}`}>{status}</span></div>
    <div className="trade-plan-grid">
      <section className="entry-plan-card">
        <div className="entry-zone-label">Suggested entry <small>{currency}</small></div>
        <div className="entry-zone-value">{available ? <>{money(plan.entryLow, currency)}<span>–</span>{money(plan.entryHigh, currency)}</> : '—'}</div>
        <div className="entry-reference">Reference entry <strong>{available ? money(plan.referenceEntry, currency) : '—'}</strong>{plan && <span>{date(plan.asOf, true)}</span>}</div>
        <div className="scenario-levels"><div><div><span>Target</span><strong>{available ? money(plan.target, currency) : '—'}</strong></div><span className="scenario-return positive">{available ? percent(plan.upsidePercent, true) : '—'}</span></div><div><div><span>Stop / invalidation</span><strong>{available ? money(plan.invalidation, currency) : '—'}</strong></div><span className="scenario-return negative">{available ? percent(plan.downsidePercent, true) : '—'}</span></div></div>
        <div className="reward-risk-row"><span>Reward / risk at upper entry</span><strong>{available && isNumber(plan.rewardRisk) ? `${number(plan.rewardRisk, 2)} : 1` : '—'}</strong></div>
        <p className="plan-timing">Window: <strong>{number(sessions)} sessions after entry.</strong> Entry valid for <strong>{number(validFor)} sessions</strong> after {plan ? date(plan.asOf, true) : 'the signal'}.</p>
        {available ? <p className="plan-return-basis">Scenario returns use the reference entry, before fees and slippage.</p> : <p className="plan-unavailable">{plan?.explanation || 'No entry scenario in this scan.'}</p>}
      </section>
      <section className={`probability-card${estimated ? ' probability-estimated' : ''}`} aria-labelledby="probability-title">
        <h4 id="probability-title">Target before stop</h4>
        <strong className="probability-value">{estimated ? `${number(probability.value)}%` : 'Unavailable'}</strong>
        {estimated ? <p className="probability-lead">Estimated for a fill at the {money(plan.referenceEntry, currency)} reference-entry limit.</p> : <p className="probability-lead">{demo ? 'Demo data has no probability estimate.' : probability?.reason || 'Insufficient evidence.'}</p>}
        <p className="probability-event-text">{probability?.event || `Target touched before invalidation within ${sessions} trading sessions after a qualifying entry.`}</p>
        {estimated && validation && <p className="probability-sample-line">{number(validation.testSamples)} test outcomes · {number(validation.testSymbols)} symbols<br />Model date: {date(probability.asOf, true)}</p>}
        {estimated && validation && <details className="validation-details"><summary>Model evidence &amp; entry rules</summary><dl>
          <div><dt>Model</dt><dd>{probability.modelVersion}</dd></div>
          <div><dt>Test period</dt><dd>{date(validation.testStart, true)} – {date(validation.testEnd, true)}</dd></div>
          <div><dt>Brier error / baseline</dt><dd>{number(validation.brier, 3)} / {number(validation.baselineBrier, 3)}</dd></div>
          <div><dt>Calibration error</dt><dd>{number(validation.calibrationError * 100, 1)} percentage points</dd></div>
          {isNumber(validation.setupSamples) && <div><dt>Same-setup samples</dt><dd>{number(validation.setupSamples)}</dd></div>}
          {isNumber(validation.binSamples) && <div><dt>Probability-band samples</dt><dd>{number(validation.binSamples)}</dd></div>}
          {isNumber(validation.observedHitRatePercent) && <div><dt>Observed band hit rate</dt><dd>{percent(validation.observedHitRatePercent)}</dd></div>}
        </dl><p>{probability.reason}</p><p>The model skips entries after an opening gap at or below invalidation. Different entry prices are not covered by this estimate. This estimates the named event, not profit after costs.</p></details>}
      </section>
    </div>
    {available && <details className="plan-rules"><summary>Entry calculation</summary><strong>{plan.basis}</strong><p>{plan.explanation}</p><p>Reward/risk uses the upper entry price. Fills and exit prices can differ from these levels.</p></details>}
    {history && <details className="historical-evidence"><summary>Historical setups · {number(history.samples)} filled samples</summary><div className="historical-evidence-content"><div className="historical-counts"><div><span>Target first</span><strong>{number(history.targetFirst)}</strong></div><div><span>Stop first</span><strong>{number(history.stopFirst)}</strong></div><div><span>Expired</span><strong>{number(history.expired)}</strong></div><div><span>Unfilled</span><strong>{number(history.unfilled)}</strong></div><div><span>Ambiguous</span><strong>{number(history.ambiguous)}</strong></div></div><div className="historical-method"><span>As of {date(history.asOf, true)}</span><span>{history.method}</span></div></div></details>}
  </section>;
}
