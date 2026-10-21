export type Strategy = 'covered-call' | 'protective-put' | 'long-call' | 'long-put';
export type OptionInputs = { sharePrice: number; strike: number; premium: number; contracts: number; fees: number };

export function validOptions(input: OptionInputs): boolean {
  return Object.values(input).every(Number.isFinite) && input.sharePrice > 0 && input.strike > 0
    && input.premium >= 0 && input.fees >= 0 && Number.isInteger(input.contracts) && input.contracts >= 1 && input.contracts <= 10000;
}

export function payoff(strategy: Strategy, terminalPrice: number, input: OptionInputs): number {
  const { sharePrice: s, strike: k, premium: p, contracts, fees } = input;
  const q = 100 * contracts;
  if (strategy === 'long-call') return q * (Math.max(terminalPrice - k, 0) - p) - fees;
  if (strategy === 'long-put') return q * (Math.max(k - terminalPrice, 0) - p) - fees;
  if (strategy === 'covered-call') return q * (Math.min(terminalPrice, k) - s + p) - fees;
  return q * (Math.max(terminalPrice, k) - s - p) - fees;
}

export function optionSummary(strategy: Strategy, input: OptionInputs) {
  const q = 100 * input.contracts;
  const { sharePrice: s, strike: k, premium: p, fees } = input;
  const feePerShare = fees / q;
  const worst = strategy === 'long-call' || strategy === 'long-put' ? -q * p - fees : payoff(strategy, 0, input);
  const best = strategy === 'covered-call' ? payoff(strategy, Math.max(s, k) * 2, input)
    : strategy === 'long-put' ? payoff(strategy, 0, input) : Infinity;
  const candidate = strategy === 'long-call' ? k + p + feePerShare
    : strategy === 'long-put' ? k - p - feePerShare
    : strategy === 'covered-call' ? s - p + feePerShare : s + p + feePerShare;
  const breakEven = candidate >= 0 && (strategy !== 'covered-call' || candidate <= k)
    && (strategy !== 'protective-put' || candidate >= k) ? candidate : null;
  return { shares: q, worst, best, maxLoss: Math.max(0, -worst), breakEven, premiumTotal: q * p,
    stockCost: strategy === 'covered-call' || strategy === 'protective-put' ? q * s : 0 };
}
