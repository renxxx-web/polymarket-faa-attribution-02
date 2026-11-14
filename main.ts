// polymarket-faa-attribution-02 — adaptive random-walk quantile forecaster (v1 baseline).
//
// Offline (Node 22, standard library only). For every case file in the input directory it writes a
// forecast file: for each market, 240 rows (one per minute after the checkpoint) of five quantiles
// (0.05, 0.25, 0.5, 0.75, 0.95) of that minute's Yes price.
//
// Model: a random walk around the last price. The median stays at the market's price at the
// checkpoint (persistence). The spread widens like sqrt(h), scaled by the market's own realised
// volatility: the root-mean-square of its 1-minute price changes over the last 240 minutes,
// shrunk toward the house prior of 0.0025 per square-root minute (equal weight) and clamped to
// [0.0008, 0.010] so a quiet or a stormy last four hours cannot produce a degenerate band.
// Quantiles are the normal quantiles at the five levels; every value is clamped to [0, 1] and
// rounded to 6 decimals, so rows are non-decreasing by construction.
//
// The program is deterministic: same input bytes, same output bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
const PRIOR_SIGMA = 0.0025;
const SIGMA_FLOOR = 0.0008;
const SIGMA_CAP = 0.01;
const VOL_WINDOW = 240;

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

/** Realised per-minute volatility of one market: RMS of its recent 1-minute changes, shrunk to the prior. */
function sigmaOf(prices: number[]): number {
  const n = prices.length;
  if (n < 2) return PRIOR_SIGMA;
  const start = Math.max(1, n - VOL_WINDOW);
  let sumSq = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    const d = (prices[i] as number) - (prices[i - 1] as number);
    if (!Number.isFinite(d)) continue; // a malformed tick must not poison the whole band
    sumSq += d * d;
    count++;
  }
  if (count === 0) return PRIOR_SIGMA;
  const rms = Math.sqrt(sumSq / count);
  const sigma = Math.sqrt((rms * rms + PRIOR_SIGMA * PRIOR_SIGMA) / 2);
  return Math.min(SIGMA_CAP, Math.max(SIGMA_FLOOR, sigma));
}

function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  const sigma = sigmaOf(m.prices);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const s = sigma * Math.sqrt(h);
    rows.push(Z.map((z) => price6(x + z * s)));
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
