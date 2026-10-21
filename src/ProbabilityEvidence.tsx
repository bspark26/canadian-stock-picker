import { date, isNumber, number } from './format';
import type { ProbabilityReport } from './types';
import { plainEnglish } from './plainEnglish';

export default function ProbabilityEvidence({ report }: { report: ProbabilityReport | null }) {
  const tested = report?.validation;
  const limitations = typeof report?.dataset?.limitations === 'string' ? [report.dataset.limitations] : report?.dataset?.limitations;
  return <section className="card model-evidence" aria-labelledby="model-evidence-title">
    <div className="model-evidence-heading"><h2 id="model-evidence-title">How the estimates were tested</h2><span className={`pill ${report?.status === 'Validated' ? 'green' : 'neutral'}`}>{report ? report.status === 'Validated' ? 'Checks passed' : 'Not enough evidence' : 'No test report'}</span></div>
    {!report ? <p className="model-report-empty">No test results loaded.</p> : <>
      <div className="model-evidence-metrics"><div><span>Past examples studied</span><strong>{number(report.data.acceptedEvents)}</strong><small>{number(report.data.symbols)} stocks</small></div><div><span>Examples reserved for testing</span><strong>{number(tested?.testSamples ?? report.splits?.test.samples)}</strong><small>Used only to test the estimates</small></div><div><span>Stocks in that test</span><strong>{isNumber(tested?.testSymbols ?? report.splits?.test.symbols) ? number(tested?.testSymbols ?? report.splits?.test.symbols) : '—'}</strong><small>A separate, later period</small></div></div>
      <div className="model-report-meta"><span>Updated {date(report.trainedAt, true)}</span>{tested && <span>Test dates: {date(tested.testStart, true)} – {date(tested.testEnd, true)}</span>}</div>
      <details className="model-research-details"><summary>Testing details and limits</summary><p>{plainEnglish(report.reason)}</p><dl>
        <div><dt>Method version</dt><dd>{report.modelVersion}</dd></div>
        {report.splits && <><div><dt>Examples used to build the estimates</dt><dd>{number(report.splits.training.samples)}</dd></div><div><dt>Examples used to adjust the estimates</dt><dd>{number(report.splits.calibration.samples)}</dd></div></>}
        {tested && <><div><dt>Prediction error (Brier)</dt><dd>{number(tested.brier, 3)}</dd></div><div><dt>Simple comparison error</dt><dd>{number(tested.baselineBrier, 3)}</dd></div><div><dt>Average gap for similar estimates</dt><dd>{number(tested.calibrationError * 100, 1)} percentage points</dd></div></>}
        {report.dataset && <div><dt>Price history used</dt><dd>{report.dataset.period.replace(/^(\d+)y$/, '$1 years')}</dd></div>}
      </dl><p>The estimate is the chance of reaching the target sell price before the lower exit price, within 20 trading days after buying at the price used in the calculation. It is not the chance of making a profit after fees.</p><p>The method was built using older prices, adjusted using a later period, and tested on a separate newest period.</p>{tested && <><p>Brier error checks probability estimates against the actual results. Lower is better. The simple comparison uses the overall success rate from the earlier period.</p><p>To check how closely the percentages matched results, similar estimates were grouped and compared with how often the target was reached first. The average gap between those numbers is shown above; it is not an accuracy percentage.</p></>}{report.dataset?.selection && <p>{plainEnglish(report.dataset.selection)}</p>}<ul>{limitations?.map((limitation, index) => <li key={index}>{plainEnglish(limitation)}</li>) || <li>Uses available price history. Missing stocks, missing data and trading costs can affect results.</li>}</ul></details>
    </>}
  </section>;
}
