# Token Radar — model radar-2

Entry for the make.fun `token-radar-01` bounty: a program that reads the sealed DefiLlama
snapshot, ranks the pre-token protocols by implied value, and hands in a web dashboard with the
board, a detail view per protocol, and a farm plan for each one.

## How it works

`main.ts` (Node 22, standard library only) reads `input/snapshot.json`, scores the board with
`lib/model.ts`, and writes `board.json`, `data.js`, `dashboard/` and `screenshots/` to the output
directory, plus `dossier.json` from the vendored `vendor/makefun-board.ts`.

The model, radar-2, is comparables-based: a protocol's implied value is its TVL times the peer
multiple of its category — the median market-cap-to-TVL ratio of the live protocols in that
category, derived from the snapshot itself — times a growth multiplier (seven-day TVL change),
a maturity multiplier (how long it has run with no token) and a chain-breadth multiplier. No
protocol name is special-cased; the same function scores every row.

The board covers all 40 watchlist protocols and every other pre-token protocol that passes the
watchlist's exclusion rule (no wrapped, staked or bridged product, no exchange, no versioned
pool name): 198 rows. Token-bearing protocols are kept apart in the Live token view, and their
market caps are the comparables that price the board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

The dashboard is a static page with no network: open `out/dashboard/index.html` with
`out/data.js` beside it. Three screenshots live in `screenshots/`: the board, a protocol's
detail view, and a filtered view.

## Files

- `main.ts` — the entrypoint: reads the snapshot, writes the board, the data and the dossier.
- `lib/model.ts` — the scoring model, the farm plans, the board's own gate check.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page the judge reads.
- `vendor/makefun-board.ts` — the kit's dossier library, unchanged.
- `screenshots/` — the three screenshots the dossier carries.
