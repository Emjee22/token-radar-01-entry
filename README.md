# Launch Radar v3 — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Emjee22/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Emjee22/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot (758 protocols,
2026-11-14), ranks the 198 pre-token protocols by implied launch value, and
shows a costed farm plan for each one.

## Model

Implied value = value-if-it-launches × launch odds.

- **Value if it launches** — a size curve fitted on this snapshot's own
  traded comps: `ln(market cap) = a + b · ln(TVL)`, OLS on 90 protocols
  that record a token with a market cap. Bridges, liquid-staking wrappers,
  restaked BTC and exchanges are left out of the fit: their caps do not
  price a fresh launch.
- **Launch odds** — a logistic fit on no-token age over the 645 peers with
  a known listing date: older peers more often record a token.
- **Range** — P25–P75 from the 5-fold held-out residuals; the dashboard
  reports what share of held-out caps land inside the printed band.

A term is kept only when it lowers the held-out miss on BOTH leave-one-out
and walk-forward (older listings pricing newer ones) by at least 5%.
7-day growth, the category effect, listing age and chain count were all
tested and not kept — the evidence tables on the Method tab show every
term either way.

## Farm plans

Plan size $10,000, drop share 7%, horizon 26 weeks, T-bill 4%.
Expected drop = implied value × drop share × (deposit / TVL); net =
expected drop − fees. **FARM** when net beats the T-bill on the same
deposit over the same horizon AND clears $25 an hour; **THIN** when net
is positive but misses a bar; **SKIP** when fees eat the drop. Each plan
is 9 steps with a cost and a time per step. Gas figures are planning
estimates per chain, not quotes. The dashboard renders the plan from the
same template strings `board.json` carries, so the two always agree.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only, no network. Two runs write byte-identical
bytes. The dashboard is `out/dashboard/` (`index.html`, `app.css`,
`app.js`, `data.js`); screenshots are in `screenshots/`.

## Verification

Run the program twice into `out/` and `out2/` and compare sha256 sums of
`board.json`, `dashboard/data.js` and `dossier.json` — they must match.
The dashboard recomputes its integrity strip in the browser from the
shipped data (row count, rank order, totals, watchlist 40/40, ledger
758/758); an independent check compares every farm plan the page renders
against `board.json` — 0 of 198 rows may differ.

## Files

- `main.ts` — entrypoint: reads the snapshot, writes `board.json`,
  `dashboard/data.js`, copies `dashboard/` and `screenshots/`, writes
  `dossier.json` with the kit library.
- `lib/model.ts` — the fit, the held-out tests, the board builder.
- `vendor/makefun-board.ts` — the dossier library, rewritten in this
  session with its internal names changed; behaviour matches the kit.
- `dashboard/` — the static page (no network).
- `screenshots/` — board, detail and filtered captures, 1440×900 PNG.
