import { Beaker, CircleHelp, FlaskConical } from 'lucide-react';
import { date, isNumber, number } from './format';
import type { ProbabilityReport } from './types';

export default function ProbabilityEvidence({ report }: { report: ProbabilityReport | null }) {
  const tested = report?.validation;
  const limitations = typeof report?.dataset?.limitations === 'string' ? [report.dataset.limitations] : report?.dataset?.limitations;
  return <section className="card model-evidence" aria-labelledby="model-evidence-title">
    <div className="model-evidence-heading"><div><div className="section-label">PROBABILITY RESEARCH</div><h2 id="model-evidence-title">Evidence behind the estimate</h2></div><span className={`pill ${report?.status === 'Validated' ? 'green' : 'neutral'}`}><Beaker size={14} />{report ? report.status === 'Validated' ? 'Validation gates met' : 'Insufficient evidence' : 'No report published'}</span></div>
    {!report ? <p className="model-report-empty"><CircleHelp size={18} /><span>No model validation report is published yet. Per-stock probability estimates remain unavailable without supporting evidence.</span></p> : <>
      <p className="model-report-reason">{report.reason}</p>
      <div className="model-evidence-metrics"><div><span>Historical outcomes accepted</span><strong>{number(report.data.acceptedEvents)}</strong><small>Across {number(report.data.symbols)} symbols</small></div><div><span>Untouched test outcomes</span><strong>{number(tested?.testSamples ?? report.splits?.test.samples)}</strong><small>{isNumber(tested?.testSymbols ?? report.splits?.test.symbols) ? `${number(tested?.testSymbols ?? report.splits?.test.symbols)} symbols in the test period` : 'A test period is not available'}</small></div><div><span>Model / baseline error</span><strong>{tested ? `${number(tested.brier, 3)} / ${number(tested.baselineBrier, 3)}` : '—'}</strong><small>Brier error · lower is better</small></div></div>
      <div className="model-report-meta"><span>Model {report.modelVersion}</span><span>Trained {date(report.trainedAt, true)}</span>{tested && <span>Test outcomes {date(tested.testStart, true)} – {date(tested.testEnd, true)}</span>}</div>
      <p className="model-evidence-context">The named event is a target touched before invalidation within 20 trading sessions after a qualifying entry. Validation uses historical periods held apart from training and calibration. Passing these checks supports an estimate within its tested scope; it does not guarantee future performance or a profitable trade after costs.</p>
      {(report.splits || report.dataset) && <details className="model-research-details"><summary>Research scope &amp; limitations</summary><dl>{report.splits && <><div><dt>Training outcomes</dt><dd>{number(report.splits.training.samples)}</dd></div><div><dt>Calibration outcomes</dt><dd>{number(report.splits.calibration.samples)}</dd></div><div><dt>Test outcomes</dt><dd>{number(report.splits.test.samples)}</dd></div></>}{tested && <div><dt>Calibration error</dt><dd>{number(tested.calibrationError * 100, 1)} percentage points</dd></div>}{report.dataset && <div><dt>History collected</dt><dd>{report.dataset.period}</dd></div>}</dl>{report.dataset?.selection && <p>{report.dataset.selection}</p>}<ul>{limitations?.map((limitation, index) => <li key={index}>{limitation}</li>) || <li>Price-only historical research. Current-listing selection, missing data and execution costs can affect how results translate to future trades.</li>}</ul></details>}
    </>}
    <div className="model-demo-boundary"><FlaskConical size={17} /><span>This report can describe real historical research while the dashboard is in demo mode. Fictional demo companies never receive these probability estimates.</span></div>
  </section>;
}
