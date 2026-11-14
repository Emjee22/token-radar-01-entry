# Token Radar — a ranked board of pre-token protocols

A make.fun `token-radar-01` entry. It reads a frozen DefiLlama protocol snapshot, scores every
pre-token protocol with a comparables model, and hands in a static dashboard: the ranked board,
a detail drawer for each protocol, and a farm plan per row.

## What it does

`main.ts` runs on Node 22 with the standard library only. It takes `input/snapshot.json`, builds
the board from `lib/model.ts`, and writes `board.json`, `data.js`, `dashboard/` and `screenshots/`
into the output directory, then `dossier.json` through the vendored `vendor/makefun-board.ts`.

The model, radar-2, prices a protocol from its own snapshot: TVL times its category's peer
multiple — the median market-cap-to-TVL ratio of the live protocols in that category — times
multipliers for seven-day growth, for age with no token, and for chain breadth. One function
scores every row; no protocol name gets special treatment.

The board holds the 40 watchlist protocols plus every other pre-token protocol that clears the
watchlist's exclusion rule — no wrapped, staked or bridged product, no exchange, no versioned
pool name) — 198 rows. Protocols that already trade live apart in the Live token view, and their
market caps are the comparables the board is priced from.

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot-file-or-dir>
```

The dashboard needs no network: open `out/dashboard/index.html` with `out/data.js` next to it.
`screenshots/` carries three captures: the board, a protocol's detail view, and a filtered view.

## Layout

- `main.ts` — entrypoint: snapshot in, board, data and dossier out.
- `lib/model.ts` — scoring model, farm plans, and the board's own gate check.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the judge's page.
- `vendor/makefun-board.ts` — the kit's dossier library (identifiers renamed, logic identical).
- `screenshots/` — the three captures the dossier carries.
