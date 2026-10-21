export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function number(value: number | null | undefined, digits = 0): string {
  return isNumber(value) ? new Intl.NumberFormat('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value) : '—';
}

export function money(value: number | null | undefined, currency = 'CAD', compact = false): string {
  if (!isNumber(value)) return '—';
  const prefix = currency === 'CAD' ? 'C$' : currency === 'USD' ? 'US$' : `${currency} `;
  const negative = value < 0 ? '−' : '';
  const magnitude = Math.abs(value);
  if (compact && magnitude >= 1e9) return `${negative}${prefix}${number(magnitude / 1e9, 2)}B`;
  if (compact && magnitude >= 1e6) return `${negative}${prefix}${number(magnitude / 1e6, 1)}M`;
  if (compact && magnitude >= 1e3) return `${negative}${prefix}${number(magnitude / 1e3, 0)}K`;
  return `${negative}${prefix}${number(magnitude, 2)}`;
}

export function percent(value: number | null | undefined, signed = false): string {
  return isNumber(value) ? `${signed && value > 0 ? '+' : ''}${number(value, 2)}%` : '—';
}

export function date(value: string | null | undefined, full = false): string {
  if (!value) return 'Not available';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.valueOf())) return 'Not available';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: full ? 'numeric' : undefined, timeZone: 'America/Toronto' }).format(parsed);
}

export function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return 'Time not available';
  return `${new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).format(parsed)} ET`;
}
