const pricePatterns: Record<string, string> = {
  'Trend continuation': 'Upward trend',
  'Pullback': 'Dip in price',
  'Range watch': 'Trading in a range',
  'Research watch': 'Needs more research',
};

const timeframes: Record<string, string> = {
  'Long term': 'Long term',
  'Swing': 'Short term',
  'Both': 'Short and long term',
};

export function pricePatternLabel(value: string): string {
  return pricePatterns[value] || value;
}

export function timeframeLabel(value: string): string {
  return timeframes[value] || value;
}
