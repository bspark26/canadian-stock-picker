import assert from 'node:assert/strict';
import test from 'node:test';
import { optionSummary, payoff, validOptions } from '../src/options.ts';

const inputs = { sharePrice: 20, strike: 22, premium: 0.8, contracts: 1, fees: 10 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);

test('premium is quoted per share, each standard contract covers 100 shares, and total fees are deducted once', () => {
  const position = { ...inputs, contracts: 2, fees: 12.5 };
  const summary = optionSummary('long-call', position);
  assert.equal(summary.shares, 200);
  assert.equal(summary.premiumTotal, 160);
  near(summary.maxLoss, 172.5);
  near(payoff('long-call', 25, position), 427.5);
  near(summary.breakEven, 22.8625);
  near(payoff('long-call', summary.breakEven, position), 0);
});

test('covered call retains stock downside and caps gains at the strike', () => {
  near(payoff('covered-call', 0, inputs), -1930);
  near(payoff('covered-call', 22, inputs), 270);
  near(payoff('covered-call', 100, inputs), 270);
  const summary = optionSummary('covered-call', inputs);
  near(summary.best, 270);
  near(summary.maxLoss, 1930);
  near(summary.breakEven, 19.3);
  near(payoff('covered-call', summary.breakEven, inputs), 0);
  assert.equal(summary.stockCost, 2000);
});

test('protective put establishes an expiry floor while preserving upside', () => {
  const position = { ...inputs, strike: 18 };
  near(payoff('protective-put', 0, position), -290);
  near(payoff('protective-put', 10, position), -290);
  near(payoff('protective-put', 18, position), -290);
  near(payoff('protective-put', 25, position), 410);
  const summary = optionSummary('protective-put', position);
  near(summary.worst, -290);
  near(summary.maxLoss, 290);
  near(summary.breakEven, 20.9);
  assert.equal(summary.best, Infinity);
  near(payoff('protective-put', summary.breakEven, position), 0);
});

test('long put loses no more than premium plus fees and reaches maximum gain at zero', () => {
  const summary = optionSummary('long-put', inputs);
  near(payoff('long-put', 22, inputs), -90);
  near(payoff('long-put', 100, inputs), -90);
  near(payoff('long-put', 0, inputs), 2110);
  near(summary.maxLoss, 90);
  near(summary.best, 2110);
  near(summary.breakEven, 21.1);
  near(payoff('long-put', summary.breakEven, inputs), 0);
  assert.equal(summary.stockCost, 0);
});

test('breakeven reflects when no nonnegative terminal stock price can offset the position cost', () => {
  const tooExpensivePut = { ...inputs, strike: 1, premium: 2 };
  assert.equal(optionSummary('long-put', tooExpensivePut).breakEven, null);
  assert.ok(optionSummary('long-put', tooExpensivePut).best < 0);
  const belowBasisCall = { ...inputs, sharePrice: 30 };
  assert.equal(optionSummary('covered-call', belowBasisCall).breakEven, null);
  assert.ok(optionSummary('covered-call', belowBasisCall).best < 0);
  assert.equal(optionSummary('protective-put', inputs).breakEven, null);
  assert.ok(optionSummary('protective-put', inputs).worst > 0);
});

test('flat zero-payoff regions include the boundary strike', () => {
  const protectedAtZero = { ...inputs, sharePrice: 21.1 };
  near(optionSummary('protective-put', protectedAtZero).worst, 0);
  near(optionSummary('protective-put', protectedAtZero).breakEven, 22);
  near(payoff('protective-put', 0, protectedAtZero), 0);
  const cappedAtZero = { ...inputs, sharePrice: 22.7 };
  near(optionSummary('covered-call', cappedAtZero).best, 0);
  near(optionSummary('covered-call', cappedAtZero).breakEven, 22);
  near(payoff('covered-call', 100, cappedAtZero), 0);
});

test('rejects fractional contracts, invalid prices, negative premiums or fees, and nonfinite inputs', () => {
  assert.equal(validOptions(inputs), true);
  for (const change of [
    { contracts: 1.5 }, { contracts: 0 }, { contracts: -1 },
    { sharePrice: 0 }, { strike: -1 }, { premium: -0.1 }, { fees: -1 },
    { fees: Number.NaN }, { premium: Infinity },
  ]) assert.equal(validOptions({ ...inputs, ...change }), false);
});
