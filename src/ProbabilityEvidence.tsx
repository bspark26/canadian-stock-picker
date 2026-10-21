import { date, isNumber, number } from './format';
import type { ProbabilityReport } from './types';

export default function ProbabilityEvidence({ report }: { report: ProbabilityReport | null }) {
  const tested = report?.validation;
  const limitations = typeof report?.dataset?.limitations === 'string' ? [report.dataset.limitations] : report?.dataset?.limitations;
  return <section className="card model-evidence" aria-labelledby="model-evidence-title">
    <div className="model-evidence-heading"><h2 id="model-evidence-title">Probability model</h2><span className={`pill ${report?.status === 'Validated' ? 'green' : 'neutral'}`}>{report ? report.status === 'Validated' ? 'Validation gates met' : 'Insufficient evidence' : 'No report'}</span></div>
    {!report ? <p className="model-report-empty">No validation report loaded.</p> : <>
      <div className="model-evidence-metrics"><div><span>Historical outcomes</span><strong>{number(report.data.acceptedEvents)}</strong><small>{number(report.data.symbols)} symbols</small></div><div><span>Held-out test outcomes</span><strong>{number(tested?.testSamples ?? report.splits?.test.samples)}</strong><small>{isNumber(tested?.testSymbols ?? report.splits?.test.symbols) ? `${number(tested?.testSymbols ?? report.splits?.test.symbols)} symbols` : '—'}</small></div><div><span>Brier error / baseline</span><strong>{tested ? `${number(tested.brier, 3)} / ${number(tested.baselineBrier, 3)}` : '—'}</strong><small>Lower error is better</small></div></div>
      <div className="model-report-meta"><span>Trained {date(report.trainedAt, true)}</span>{tested && <span>Test: {date(tested.testStart, true)} – {date(tested.testEnd, true)}</span>}</div>
      <details className="model-research-details"><summary>Method &amp; limitations</summary><p>{report.reason}</p><dl><div><dt>Model</dt><dd>{report.modelVersion}</dd></div>{report.splits && <><div><dt>Training outcomes</dt><dd>{number(report.splits.training.samples)}</dd></div><div><dt>Calibration outcomes</dt><dd>{number(report.splits.calibration.samples)}</dd></div></>}{tested && <div><dt>Calibration error</dt><dd>{number(tested.calibrationError * 100, 1)} percentage points</dd></div>}{report.dataset && <div><dt>History</dt><dd>{report.dataset.period}</dd></div>}</dl><p>Estimates target before invalidation within 20 sessions after a reference-entry fill. Test periods are held apart from training and calibration. This is not a probability of profit after costs.</p>{report.dataset?.selection && <p>{report.dataset.selection}</p>}<ul>{limitations?.map((limitation, index) => <li key={index}>{limitation}</li>) || <li>Price-only research using available listings; missing data and execution costs affect results.</li>}</ul></details>
    </>}
  </section>;
}
