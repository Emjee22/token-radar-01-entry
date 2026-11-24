// Token Radar v3 — entrypoint.
//
// Reads the sealed snapshot, fits the model (lib/model.ts), writes the
// ranked board, the dashboard's data, copies the dashboard and the
// screenshots, and writes the dossier with the kit's library. Node 22,
// standard library only, no network. Two runs write byte-identical bytes:
// the fit is deterministic, the bootstrap uses a fixed seed, and nothing
// reads the clock.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';
import { FARM_STEP_TEMPLATES, TIER_TX_USD, buildRadar } from './lib/model.ts';
import type { RadarOutput } from './lib/model.ts';

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function main(): void {
  const args = process.argv.slice(2);
  let inputPath = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) inputPath = args[i + 1]!;
  }
  if (!inputPath) {
    const fallback = join(process.cwd(), 'input', 'snapshot.json');
    inputPath = existsSync(fallback) ? fallback : '/input/snapshot.json';
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? 'out';
  const root = process.cwd();

  const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
  const radar: RadarOutput = buildRadar(snapshot);

  // ---- board.json (the gate's rows, plus the fields the dashboard shows)
  const boardRows = radar.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
    category: r.category,
    chain: r.chain,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_years: r.age_years === null ? null : round(r.age_years, 2),
    watchlist: r.watchlist,
    off_list: r.off_list,
    odds: round(r.odds, 3),
    if_launches_usd: r.if_launches_usd,
    p25_usd: r.p25_usd,
    p75_usd: r.p75_usd,
    size_multiple: round(r.size_multiple, 4),
    fee_usd: round(r.fee_usd, 2),
    hours: round(r.hours, 2),
    net_usd: round(r.net_usd, 2),
    net_per_hour: round(r.net_per_hour, 2),
    verdict: r.verdict,
    boot_lo: r.boot_lo,
    boot_hi: r.boot_hi,
    gas_tier: r.gas_tier,
  }));
  const boardJson = JSON.stringify({ rows: boardRows }, null, 2) + '\n';
  const boardChecksum = sha256Hex(Buffer.from(boardJson, 'utf8'));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), boardJson);

  // ---- dashboard/data.js (one compact object; rows are positional arrays)
  const cats: string[] = [];
  const catIndex = new Map<string, number>();
  const chains: string[] = [];
  const chainIndex = new Map<string, number>();
  for (const r of radar.rows) {
    const c = r.category ?? '';
    if (!catIndex.has(c)) {
      catIndex.set(c, cats.length);
      cats.push(c);
    }
    if (!chainIndex.has(r.chain)) {
      chainIndex.set(r.chain, chains.length);
      chains.push(r.chain);
    }
  }
  for (const c of radar.comps) {
    const k = c.category ?? '';
    if (!catIndex.has(k)) {
      catIndex.set(k, cats.length);
      cats.push(k);
    }
  }
  const rowArrays = radar.rows.map((r) => [
    r.slug,
    r.name,
    catIndex.get(r.category ?? '') ?? -1,
    chainIndex.get(r.chain) ?? -1,
    r.tvl_usd,
    r.change_7d === null ? null : round(r.change_7d, 1),
    r.age_years === null ? null : round(r.age_years, 1),
    round(r.odds, 3),
    r.implied_value_usd,
    round(r.fee_usd, 2),
    r.boot_lo,
    r.boot_hi,
    r.gas_tier,
    r.if_launches_usd,
    r.p25_usd,
    r.p75_usd,
    r.watchlist ? 1 : 0,
  ]);
  const data = {
    as_of: radar.as_of,
    checksum: boardChecksum.slice(0, 8),
    plan: { deposit: radar.plan_deposit, drop_share: radar.plan_drop_share, weeks: radar.plan_weeks, tbill: radar.tbill },
    model: {
      size_a: round(radar.evidence.size_a, 3),
      size_b: round(radar.evidence.size_b, 3),
      odds_a: round(radar.evidence.odds_a, 3),
      odds_b: round(radar.evidence.odds_b, 3),
      band_lo: round(radar.evidence.band_lo, 3),
      band_hi: round(radar.evidence.band_hi, 3),
      band10: round(radar.evidence.band10, 3),
      band90: round(radar.evidence.band90, 3),
    },
    evidence: {
      comps: radar.evidence.comps,
      peers: radar.evidence.peers,
      base_rate: round(radar.evidence.base_rate, 3),
      size_loo: round(radar.evidence.size_loo, 2),
      size_walk: round(radar.evidence.size_walk, 2),
      size_five_fold: round(radar.evidence.size_five_fold, 2),
      flat_loo: round(radar.evidence.flat_loo, 2),
      flat_walk: round(radar.evidence.flat_walk, 2),
      range_honesty: round(radar.evidence.range_honesty, 3),
      odds_five_fold: round(radar.evidence.odds_five_fold, 3),
      odds_walk: round(radar.evidence.odds_walk, 3),
      odds_base_five_fold: round(radar.evidence.odds_base_five_fold, 3),
      odds_base_walk: round(radar.evidence.odds_base_walk, 3),
      flat_multiple: round(radar.evidence.flat_multiple, 3),
      farm: radar.evidence.farm_count,
      thin: radar.evidence.thin_count,
      skip: radar.evidence.skip_count,
      total_implied: radar.evidence.total_implied,
      value_terms: radar.evidence.value_terms.map((t) => [t.term, round(t.loo, 2), round(t.walk_forward, 2), t.kept ? 1 : 0, t.note]),
      odds_terms: radar.evidence.odds_terms.map((t) => [t.term, round(t.five_fold, 3), round(t.walk_forward, 3), t.kept ? 1 : 0, t.note]),
    },
    accounting: radar.accounting,
    cats,
    chains,
    steps: FARM_STEP_TEMPLATES,
    tx: TIER_TX_USD,
    comps: radar.comps.map((c) => [c.name, catIndex.get(c.category ?? '') ?? -1, c.tvl, c.mcap]),
    rows: rowArrays,
  };
  const dataJs = 'const RADAR = ' + JSON.stringify(data) + ';\n';

  // ---- dashboard: copy the page, write its data beside it
  const dashOut = join(outDir, 'dashboard');
  mkdirSync(dashOut, { recursive: true });
  const dashSrc = join(root, 'dashboard');
  for (const f of readdirSync(dashSrc)) {
    const src = join(dashSrc, f);
    const dst = join(dashOut, f);
    cpSync(src, dst, { recursive: false });
  }
  writeFileSync(join(dashOut, 'data.js'), dataJs);

  // ---- screenshots: copy the rendered captures
  const shotsOut = join(outDir, 'screenshots');
  mkdirSync(shotsOut, { recursive: true });
  const shotsSrc = join(root, 'screenshots');
  for (const f of readdirSync(shotsSrc)) {
    if (f.startsWith('.')) continue;
    cpSync(join(shotsSrc, f), join(shotsOut, f), { recursive: false });
  }

  // ---- dossier: the kit library's own bytes, byte for byte
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const total = radar.evidence.total_implied;
  console.log(`token-radar v3: ${radar.rows.length} rows, watchlist ${radar.accounting.watchlist}/40`);
  console.log(`top-1 ${radar.rows[0]!.name} $${radar.rows[0]!.implied_value_usd.toLocaleString('en-US')}, total $${total.toLocaleString('en-US')}`);
  console.log(`size curve ln cap = ${radar.evidence.size_a.toFixed(3)} + ${radar.evidence.size_b.toFixed(3)} ln TVL (${radar.evidence.comps} comps)`);
  console.log(`held-out miss LOO x${radar.evidence.size_loo.toFixed(2)} (flat x${radar.evidence.flat_loo.toFixed(2)}), walk-forward x${radar.evidence.size_walk.toFixed(2)} (flat x${radar.evidence.flat_walk.toFixed(2)})`);
  console.log(`odds Brier 5-fold ${radar.evidence.odds_five_fold.toFixed(3)} vs base ${radar.evidence.odds_base_five_fold.toFixed(3)}, walk-forward ${radar.evidence.odds_walk.toFixed(3)} vs base ${radar.evidence.odds_base_walk.toFixed(3)}`);
  console.log(`range honesty ${(radar.evidence.range_honesty * 100).toFixed(0)}%, farm ${radar.evidence.farm_count} / thin ${radar.evidence.thin_count} / skip ${radar.evidence.skip_count}`);
  console.log(`board checksum ${boardChecksum.slice(0, 8)}, dossier ${dossier.length} bytes`);
}

main();
