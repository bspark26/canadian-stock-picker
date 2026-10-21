import { ArrowDownRight, ArrowUpRight, Clock3, Crosshair, History, Info, Scale, Target } from 'lucide-react';
import { date, isNumber, money, number, percent } from './format';
import type { TradePlan as Plan } from './types';

export function EntryScenarioCell({ plan, currency }: { plan?: Plan; currency: string }) {
  const available = plan && plan.status !== 'Unavailable';
  return <div className="entry-scenario-cell"><strong>{available ? `${money(plan.entryLow, currency)} – ${money(plan.entryHigh, currency)}` : '—'}</strong><span>{!plan ? 'Plan not yet available' : plan.status === 'Unavailable' ? 'No qualifying setup' : plan.status === 'Wait' ? 'Wait for entry zone' : 'Conditional entry zone'}</span></div>;
}

export function UpsideScenarioCell({ plan, demo }: { plan?: Plan; demo: boolean }) {
  const available = plan && plan.status !== 'Unavailable';
  const estimated = !demo && available && plan.probability.status === 'Estimated' && isNumber(plan.probability.value);
  return <><div className="upside-scenario-cell"><strong>{available ? percent(plan.upsidePercent, true) : '—'}</strong><span>{available ? `${number(plan.horizonSessions)} sessions · scenario` : 'Not estimated'}</span></div>{estimated && <div className="table-probability"><strong>{number(plan.probability.value)}%</strong><span>estimated target-hit</span></div>}</>;
}

export default function TradePlan({ plan, currency, demo }: { plan?: Plan; currency: string; demo: boolean }) {
  const available = plan && plan.status !== 'Unavailable';
  const sessions = plan?.horizonSessions || 20;
  const validFor = plan?.entryValidForSessions || 5;
  const history = !demo && plan?.historical?.method.trim() && plan.historical.asOf
    && !/synthetic|demo|illustrative/i.test(plan.historical.method) ? plan.historical : null;
  const probability = plan?.probability;
  const estimated = !demo && plan?.status !== 'Unavailable' && probability?.status === 'Estimated' && isNumber(probability.value);
  const validation = estimated ? probability.validation : null;
  const probabilityStatus = demo ? 'Not calibrated' : probability?.status || 'Not calibrated';
  const status = !plan ? 'Plan not yet available' : plan.status === 'Unavailable' ? 'Setup unavailable' : plan.status === 'Wait' ? 'Wait for entry' : 'Conditional setup';
  return <section className="trade-plan-section" aria-labelledby="trade-plan-title">
    <div className="trade-plan-heading"><div><span className="section-label">PRICE, TIMING &amp; UNCERTAINTY</span><h3 id="trade-plan-title">Entry &amp; return scenario</h3></div><span className={`pill ${plan?.status === 'Ready' ? 'green' : plan?.status === 'Wait' ? 'amber' : 'neutral'}`}>{status}</span></div>
    <div className="trade-plan-grid">
      <section className="entry-plan-card">
        <div className="entry-zone-label"><Crosshair size={16} /><span>Suggested entry zone <small>{currency}</small></span></div>
        <div className="entry-zone-value">{available ? <>{money(plan.entryLow, currency)}<span>to</span>{money(plan.entryHigh, currency)}</> : '—'}</div>
        <div className="entry-reference">Reference entry <strong>{available ? money(plan.referenceEntry, currency) : '—'}</strong>{plan && <span>As of {date(plan.asOf, true)}</span>}</div>
        <div className="scenario-levels"><div><span className="scenario-level-icon target"><Target size={16} /></span><div><span>Target scenario</span><strong>{available ? money(plan.target, currency) : '—'}</strong></div><span className="scenario-return positive">{available ? <><ArrowUpRight size={14} />{percent(plan.upsidePercent, true)}</> : '—'}</span></div><div><span className="scenario-level-icon invalidation"><ArrowDownRight size={16} /></span><div><span>Invalidation level</span><strong>{available ? money(plan.invalidation, currency) : '—'}</strong></div><span className="scenario-return negative">{available ? <><ArrowDownRight size={14} />{percent(plan.downsidePercent, true)}</> : '—'}</span></div></div>
        <div className="reward-risk-row"><Scale size={15} /><span>Reward / risk at upper entry</span><strong>{available && isNumber(plan.rewardRisk) ? `${number(plan.rewardRisk, 2)} : 1` : '—'}</strong></div>
        <div className="plan-timing"><Clock3 size={14} /><span><strong>{number(sessions)} trading sessions</strong> after a qualifying entry<span className="timing-divider">·</span>Entry window: <strong>{number(validFor)} sessions</strong> following {plan ? date(plan.asOf, true) : 'the signal date'}</span></div>
        {!available && <div className="plan-unavailable"><Info size={15} /><p>{plan?.explanation || 'This published snapshot does not yet contain an entry and return plan. No entry, target or return has been inferred.'}</p></div>}
        {available && <p className="plan-return-basis">Returns use the reference entry, before fees and slippage. Reward / risk uses the upper entry price, the least favourable price in this zone.</p>}
      </section>
      <section className={`probability-card${estimated ? ' probability-estimated' : ''}`} aria-labelledby="probability-title">
        <div className="probability-eyebrow"><span className="uncertainty-mark">{estimated ? '%' : '?'}</span><span>TARGET-HIT PROBABILITY</span></div>
        <h4 id="probability-title">{estimated ? <><span className="probability-value">{number(probability.value)}%</span><span className="probability-estimate-label">Estimated target-hit probability</span></> : probabilityStatus}</h4>
        <p className="probability-lead">{estimated ? `Conditional on a fill at the ${money(plan?.referenceEntry, currency)} reference-entry limit, under the model’s entry rules.` : 'No supported percentage is available for this setup.'}</p>
        <div className="probability-event"><span>{estimated ? 'THE SPECIFIC OUTCOME ESTIMATED' : 'THE EVENT WE WOULD MEASURE'}</span><p>{probability?.event || `Target touched before invalidation within ${sessions} trading sessions after a qualifying entry.`}</p></div>
        <p className="probability-reason">{demo ? 'This is an illustrative demo. Synthetic prices cannot establish a real-world success probability or historical hit rate.' : probability?.reason || 'An out-of-sample calibration has not established the likelihood of this outcome.'}</p>
        {estimated && validation && <div className="probability-support"><p><strong>{number(validation.testSamples)} held-out outcomes</strong> across {number(validation.testSymbols)} symbols</p><p>{date(validation.testStart, true)} – {date(validation.testEnd, true)}</p><p>Estimate as of {date(probability.asOf, true)}</p><details className="validation-details"><summary>Model evidence &amp; baseline</summary><dl><div><dt>Model</dt><dd>{probability.modelVersion}</dd></div><div><dt>Brier error</dt><dd>{number(validation.brier, 3)}</dd></div><div><dt>Baseline Brier error</dt><dd>{number(validation.baselineBrier, 3)}</dd></div><div><dt>Calibration error</dt><dd>{number(validation.calibrationError * 100, 1)} percentage points</dd></div>{isNumber(validation.setupSamples) && <div><dt>Same-setup examples</dt><dd>{number(validation.setupSamples)}</dd></div>}{isNumber(validation.binSamples) && <div><dt>Calibration-bin examples</dt><dd>{number(validation.binSamples)}</dd></div>}{isNumber(validation.observedHitRatePercent) && <div><dt>Observed calibration-bin rate</dt><dd>{percent(validation.observedHitRatePercent)}</dd></div>}</dl><p>Lower Brier error is better. The baseline uses historical event frequency. Test results describe past held-out outcomes; future performance can differ.</p></details></div>}
        <div className="probability-footer"><Info size={14} /><span>{estimated ? 'A different entry price changes this estimate. An opening gap at or below invalidation cancels the entry under the model rules. Target-hit probability does not measure profit after costs; fills and exit prices can differ.' : 'A screening score or past hit rate is not a forecast probability.'}</span></div>
      </section>
    </div>
    {available && <div className="trade-plan-explanation"><strong>{plan.basis || 'Technical scenario'}</strong><p>{plan.explanation}</p></div>}
    {history && <details className="historical-evidence"><summary><History size={15} /><span>Past setup diagnostics</span><span className="history-count">{number(history.samples)} filled samples</span></summary><div className="historical-evidence-content"><p>Same-symbol, price-only historical counts, not an estimated chance for this setup. Unfilled entries are separate. Ambiguous bars are included in filled outcomes with conservative ordering.</p><div className="historical-counts"><div><span>Target first</span><strong>{number(history.targetFirst)}</strong></div><div><span>Invalidation first</span><strong>{number(history.stopFirst)}</strong></div><div><span>Window expired</span><strong>{number(history.expired)}</strong></div><div><span>Unfilled entries</span><strong>{number(history.unfilled)}</strong></div><div><span>Ambiguous bars</span><strong>{number(history.ambiguous)}</strong></div></div><div className="historical-method"><span>As of {date(history.asOf, true)}</span><span>Method: {history.method}</span></div></div></details>}
    <p className="plan-scope-note">This is a conditional technical timing scenario, separate from a long-term business thesis. Entry fills, targets and invalidation exit prices are not guaranteed.</p>
  </section>;
}
