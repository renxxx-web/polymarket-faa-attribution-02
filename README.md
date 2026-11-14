# polymarket-faa-attribution-02 — adaptive random-walk quantile forecaster

Entry for make.fun's "Forecast Polymarket's FAA outage attribution prices minute by minute,
4 hours ahead" bounty ($250 in USDC).

`main.ts` (Node 22, standard library only, offline) reads one case file per run — every market of
the FAA outage attribution family with its minute-by-minute Yes prices up to a checkpoint — and
writes, for each market and each of the 240 minutes after the checkpoint, five quantiles
(0.05, 0.25, 0.5, 0.75, 0.95) of that minute's price, scored by mean pinball loss.

The forecast is a random walk around the last price: the median persists, and the band widens
like sqrt(h) scaled by each market's own realised volatility, estimated from its recent
1-minute price changes and shrunk toward a fixed prior so quiet or stormy stretches cannot
produce degenerate bands. All values are clamped to [0, 1]; the program is deterministic.
