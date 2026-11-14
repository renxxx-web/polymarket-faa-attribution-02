// polymarket-faa-attribution-02 — calibrated realised-volatility quantile forecaster (v2).
//
// Offline (Node 22, standard library only). For every case file in the input directory it writes a
// forecast file: for each market, 240 rows (one per minute after the checkpoint) of five quantiles
// (0.05, 0.25, 0.5, 0.75, 0.95) of that minute's Yes price. Scored by mean pinball loss.
//
// What the practice cases (six checkpoints of a same-shaped Polymarket event, scored against the
// following checkpoint's recorded prices) support, and what this program does:
//   - The median is near-persistence with two small, opposing pulls: a short-horizon momentum
//     term (+0.15 of the last 30 minutes' move, phased in over ~2 hours) and a mild reversion
//     (20% of the gap to the last 240 minutes' mean, phased in over ~4 hours).
//   - The band is scaled by the market's own realised volatility: the RMS of its 1-minute
//     changes over the last 120 minutes, clamped to [0.0005, 0.010] per square-root minute.
//     Two quiet hours must not promise a quiet future, and two stormy hours must not blow the
//     band up without limit, hence the clamp rather than a prior-shrinkage.
//   - The band widens like h^0.35, not sqrt(h): over four hours these prices do not diffuse
//     like a random walk — moves partially reverse, so cumulative variance grows sub-linearly.
//     On the practice overlap this single change is worth more than everything else combined.
//   - Tail quantiles are widened a little more than the inner ones (factor 1.20 vs 0.90 on the
//     normal quantiles) and carry a small jump floor: an extra variance term (0.0003*sqrt(h))^2
//     added in quadrature, so a market that has not moved recently still prices some jump risk.
// Every value is clamped to [0, 1] and rounded to 6 decimals; rows are non-decreasing because the
// median sits between symmetric inner/outer offsets. The program is deterministic.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z_TAIL = 1.644854; // standard normal quantile at 0.95
const Z_INNER = 0.67449; // standard normal quantile at 0.75
const K_TAIL = 1.2;
const K_INNER = 0.9;
const VOL_WINDOW = 120;
const SIGMA_FLOOR = 0.0005;
const SIGMA_CAP = 0.01;
const GROWTH_POW = 0.35;
const JUMP_SIGMA = 0.0003;
const TREND_LAMBDA = 0.15;
const TREND_LAG = 30;
const TREND_H = 120;
const REVERT_KAPPA = 0.2;
const REVERT_WINDOW = 240;
const REVERT_H = 240;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** RMS of the 1-minute changes over the last `window` minutes (all of them, when fewer exist). */
function rmsRecent(prices: number[], window: number): number {
  const n = prices.length;
  const start = Math.max(1, n - window);
  let sumSq = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    const d = (prices[i] as number) - (prices[i - 1] as number);
    if (!Number.isFinite(d)) continue;
    sumSq += d * d;
    count++;
  }
  return count === 0 ? 0 : Math.sqrt(sumSq / count);
}

/** Mean of the last `window` prices (all of them, when fewer exist). */
function meanRecent(prices: number[], window: number): number {
  const start = Math.max(0, prices.length - window);
  let sum = 0;
  for (let i = start; i < prices.length; i++) sum += prices[i] as number;
  return sum / (prices.length - start);
}

function forecast(m: CaseMarket, horizon: number): number[][] {
  const prices = m.prices;
  if (prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = prices[prices.length - 1] as number;
  const sigma = Math.min(SIGMA_CAP, Math.max(SIGMA_FLOOR, rmsRecent(prices, VOL_WINDOW)));
  const lagPrice = prices.length > TREND_LAG ? (prices[prices.length - 1 - TREND_LAG] as number) : (prices[0] as number);
  const trendMove = x - lagPrice;
  const meanTarget = meanRecent(prices, REVERT_WINDOW);
  // Phase-in shapes, normalised so the trend term reaches its full weight at the horizon's end
  // and the reversion term approaches its weight asymptotically.
  const trendShapeDenom = 1 - Math.exp(-horizon / TREND_H);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    let med = x + TREND_LAMBDA * trendMove * ((1 - Math.exp(-h / TREND_H)) / trendShapeDenom);
    med = med + REVERT_KAPPA * (1 - Math.exp(-h / REVERT_H)) * (meanTarget - med);
    med = clamp01(med);
    const g = Math.pow(h, GROWTH_POW);
    const inner = sigma * g;
    const tail = Math.sqrt((sigma * g) * (sigma * g) + JUMP_SIGMA * JUMP_SIGMA * h);
    rows.push([
      price6(med - Z_TAIL * K_TAIL * tail),
      price6(med - Z_INNER * K_INNER * inner),
      price6(med),
      price6(med + Z_INNER * K_INNER * inner),
      price6(med + Z_TAIL * K_TAIL * tail),
    ]);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j]))
    throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
