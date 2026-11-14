# polymarket-faa-attribution-02 — calibrated realised-volatility quantile forecaster

Entry for make.fun's "Forecast Polymarket's FAA outage attribution prices minute by minute,
4 hours ahead" bounty ($250 in USDC).

`main.ts` (Node 22, standard library only, offline) reads one case file per run — every market of
the FAA outage attribution family with its minute-by-minute Yes prices up to a checkpoint — and
writes, for each market and each of the 240 minutes after the checkpoint, five quantiles
(0.05, 0.25, 0.5, 0.75, 0.95) of that minute's price, scored by mean pinball loss.

The model, calibrated on the kit's practice cases (a same-shaped Polymarket event scored against
the following checkpoint's recorded prices):

- the median is near-persistence, with a small short-horizon momentum term and a mild reversion
  toward the last four hours' mean;
- the band is scaled by each market's own realised volatility — the RMS of its 1-minute changes
  over the last 120 minutes, clamped to [0.0005, 0.010];
- the band widens like h^0.35 rather than sqrt(h): over four hours these prices partially
  reverse their moves, so cumulative variance grows sub-linearly;
- tail quantiles are widened slightly more than the inner ones and carry a small jump floor, so
  a market that has not moved recently still prices some jump risk.

All values are clamped to [0, 1]; the program is deterministic (two runs, byte-identical
output) and runs a case in well under a second.
