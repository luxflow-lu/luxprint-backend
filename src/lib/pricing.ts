const FX_MODE = process.env.PRICING_FX_MODE || 'fixed';
const FIXED_FX = Number(process.env.PRICING_FIXED_FX || '0.93');
const MARGIN_PCT = Number(process.env.PRICING_MARGIN_PCT || '0.35');
const MARGIN_FIXED = Number(process.env.PRICING_MARGIN_FIXED || '1');
const ROUND_TO = Number(process.env.PRICING_ROUND_TO || '0.5');
const CURR = (process.env.CURRENCY || 'eur').toLowerCase();
const ENFORCE = (process.env.PRICING_ENFORCE || 'false').toLowerCase() === 'true';

function roundToMultiple(amount: number, step: number) {
  if (!step) return Math.round(amount * 100) / 100;
  const n = Math.round(amount / step) * step;
  return Math.round(n * 100) / 100;
}
export async function usdToEur(usd: number): Promise<number> {
  if (FX_MODE === 'fixed') return usd * FIXED_FX;
  return usd * FIXED_FX; // hook ECB désactivé
}
export function applyMargin(baseEur: number): number {
  const withPct = baseEur * (1 + MARGIN_PCT);
  const withFixed = withPct + MARGIN_FIXED;
  return roundToMultiple(withFixed, ROUND_TO);
}
/** Renvoie le prix en CENTS EUR. Si ENFORCE=true et usd_base fourni, on calcule côté serveur. */
export async function computeUnitAmountCents(args: { usd_base?: number; fallback_unit_price?: number }) {
  if (ENFORCE && args.usd_base && args.usd_base > 0) {
    const eur = await usdToEur(args.usd_base);
    const final = applyMargin(eur);
    return Math.round(final * 100);
  }
  return Math.round(Math.max(0, args.fallback_unit_price || 0));
}
export function currency() { return CURR; }
