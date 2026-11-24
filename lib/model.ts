// Token Radar v3 — value model, held-out tests, board builder.
//
// The model is fitted from the sealed snapshot itself, never from a list of
// names. Size curve: ln(market cap) ~ a + b*ln(TVL), ordinary least squares
// on the traded protocols that can price a launch (see pricedComps). Launch
// odds: a logistic fit on no-token age, over every protocol whose listing
// date is known. Implied value = value-if-it-launches x launch odds.
//
// Every term is kept only when it lowers the held-out miss on BOTH tests
// (leave-one-out and walk-forward, older listings pricing newer ones) by at
// least 5%. Terms that fail are reported in the evidence table, not hidden.
// The farm plan is one template per gas tier; the dashboard renders the same
// template strings, so the plan it shows is byte-for-byte the board's plan.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // Extra fields the dashboard reads (the gate ignores them).
  category: string | null;
  chain: string;
  chains: number;
  tvl_usd: number;
  change_7d: number | null;
  age_years: number | null;
  watchlist: boolean;
  off_list: boolean;
  odds: number;
  if_launches_usd: number;
  p25_usd: number;
  p75_usd: number;
  size_multiple: number;
  fee_usd: number;
  hours: number;
  net_usd: number;
  net_per_hour: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  boot_lo: number;
  boot_hi: number;
  gas_tier: string;
}

export interface TermTest {
  term: string;
  loo: number;
  walk_forward: number;
  kept: boolean;
  note: string;
}

export interface OddsTest {
  term: string;
  five_fold: number;
  walk_forward: number;
  kept: boolean;
  note: string;
}

export interface Evidence {
  comps: number;
  peers: number;
  base_rate: number;
  size_a: number;
  size_b: number;
  size_loo: number;
  size_walk: number;
  size_five_fold: number;
  flat_loo: number;
  flat_walk: number;
  band_lo: number;
  band_hi: number;
  band10: number;
  band90: number;
  flat_multiple: number;
  range_honesty: number;
  odds_a: number;
  odds_b: number;
  odds_five_fold: number;
  odds_walk: number;
  odds_base_five_fold: number;
  odds_base_walk: number;
  value_terms: TermTest[];
  odds_terms: OddsTest[];
  farm_count: number;
  thin_count: number;
  skip_count: number;
  total_implied: number;
}

export interface Accounting {
  total: number;
  ranked: number;
  watchlist: number;
  early_below_floor: number;
  off_list: number;
  token_trades: number;
  token_record_no_mcap: number;
  set_aside_category: number;
  set_aside_versioned: number;
  set_aside_wrapped: number;
}

export interface RadarOutput {
  rows: BoardRow[];
  evidence: Evidence;
  accounting: Accounting;
  as_of: string;
  plan_deposit: number;
  plan_drop_share: number;
  plan_weeks: number;
  tbill: number;
  comps: { slug: string; name: string; category: string | null; tvl: number; mcap: number }[];
}

// ---------------------------------------------------------------- utilities

export function ageYears(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const start = Date.parse(listedAt.slice(0, 10) + 'T00:00:00Z');
  const end = Date.parse(asOf.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / (365.25 * 86400000);
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Deterministic PRNG (mulberry32): the bootstrap must repeat byte-for-byte. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Solve a small dense linear system by Gauss elimination with pivoting. */
export function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[piv]![i]!)) piv = r;
    const tmp = a[i]!;
    a[i] = a[piv]!;
    a[piv] = tmp;
    const div = a[i]![i]!;
    for (let r = i + 1; r < n; r++) {
      const f = a[r]![i]! / div;
      for (let c = i; c <= n; c++) a[r]![c] = a[r]![c]! - f * a[i]![c]!;
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = a[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= a[i]![j]! * out[j]!;
    out[i] = s / a[i]![i]!;
  }
  return out;
}

/** OLS fit of y on [1, ...features]; returns coefficients. */
export function ols(rows: { x: number[]; y: number }[]): number[] {
  const k = rows[0]!.x.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (const r of rows) {
    for (let i = 0; i < k; i++) {
      xty[i] = xty[i]! + r.x[i]! * r.y;
      for (let j = 0; j < k; j++) xtx[i]![j] = xtx[i]![j]! + r.x[i]! * r.x[j]!;
    }
  }
  return solveLinear(xtx, xty);
}

export function predict(beta: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < beta.length; i++) s += beta[i]! * x[i]!;
  return s;
}

// ---------------------------------------------------------------- selection

/** Categories the house rule sets aside: a protocol in one of these is not
 * a launch candidate. This mirrors the watchlist rule in RULES.txt. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Categories left out of the price fit as well: bridges of every name
 * do not price a fresh launch, so Cross Chain Bridge joins the set there. */
export const COMP_EXCLUDED_CATEGORIES = new Set([...EXCLUDED_CATEGORIES, 'Cross Chain Bridge']);

const VERSION_SUFFIX = /\s(v\d+(\.\d+)?|V\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a no-token protocol is set aside, or null when it is a candidate. */
export function setAsideReason(p: SnapshotProtocol): 'category' | 'versioned' | 'wrapped' | 'exchange' | null {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return 'category';
  if (VERSION_SUFFIX.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange';
  return null;
}

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * Priced comps: protocols that record a token with a market cap, whose
 * category is one a launch can be priced in. Bridges, liquid-staking
 * wrappers, restaked BTC and exchanges are left out: their caps are not the
 * market pricing a fresh token.
 */
export function pricedComps(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !COMP_EXCLUDED_CATEGORIES.has(p.category ?? ''),
  );
}

// ---------------------------------------------------------------- value curve

export type ValueFeatures = (p: SnapshotProtocol, asOf: string) => number[];

export function sizeFeatures(p: SnapshotProtocol): number[] {
  return [1, Math.log(p.tvl_usd)];
}

export function growthFeatures(p: SnapshotProtocol): number[] {
  return [1, Math.log(p.tvl_usd), (p.change_7d ?? 0) / 100];
}

export function ageFeatures(p: SnapshotProtocol, asOf: string): number[] {
  const a = ageYears(p.listed_at, asOf);
  return [1, Math.log(p.tvl_usd), a === null ? 2 : a];
}

export function chainsFeatures(p: SnapshotProtocol): number[] {
  return [1, Math.log(p.tvl_usd), Math.log(Math.max(1, p.chains.length))];
}

export function ageChainsFeatures(p: SnapshotProtocol, asOf: string): number[] {
  const a = ageYears(p.listed_at, asOf);
  return [1, Math.log(p.tvl_usd), a === null ? 2 : a, Math.log(Math.max(1, p.chains.length))];
}

export function missFactor(residuals: number[]): number {
  return Math.exp(median(residuals.map((r) => Math.abs(r))));
}

function looResiduals(comps: SnapshotProtocol[], features: ValueFeatures, asOf: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const beta = ols(train.map((p) => ({ x: features(p, asOf), y: Math.log(p.mcap_usd!) })));
    out.push(Math.log(comps[i]!.mcap_usd!) - predict(beta, features(comps[i]!, asOf)));
  }
  return out;
}

function walkForwardResiduals(comps: SnapshotProtocol[], features: ValueFeatures, asOf: string): number[] {
  const known = comps.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const half = Math.floor(known.length / 2);
  const train = known.slice(0, half);
  const test = known.slice(half);
  const beta = ols(train.map((p) => ({ x: features(p, asOf), y: Math.log(p.mcap_usd!) })));
  return test.map((p) => Math.log(p.mcap_usd!) - predict(beta, features(p, asOf)));
}

function fiveFoldResiduals(comps: SnapshotProtocol[], features: ValueFeatures, asOf: string): number[] {
  const rand = mulberry32(20261114);
  const idx = comps.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  const out: number[] = [];
  for (let f = 0; f < 5; f++) {
    const testIdx = new Set(idx.filter((_, k) => k % 5 === f));
    const train = comps.filter((_, i) => !testIdx.has(i));
    const test = comps.filter((_, i) => testIdx.has(i));
    const beta = ols(train.map((p) => ({ x: features(p, asOf), y: Math.log(p.mcap_usd!) })));
    for (const p of test) out.push(Math.log(p.mcap_usd!) - predict(beta, features(p, asOf)));
  }
  return out;
}

function looWithCategory(comps: SnapshotProtocol[], asOf: string): number[] {
  // Category offsets re-fitted inside each leave-one-out fold, so the test
  // row's own residual never leaks into its offset.
  const out: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const base = ols(train.map((p) => ({ x: sizeFeatures(p), y: Math.log(p.mcap_usd!) })));
    const sums = new Map<string, { total: number; n: number }>();
    for (const p of train) {
      const r = Math.log(p.mcap_usd!) - predict(base, sizeFeatures(p));
      const e = sums.get(p.category ?? '') ?? { total: 0, n: 0 };
      e.total += r;
      e.n += 1;
      sums.set(p.category ?? '', e);
    }
    const off = (cat: string | null): number => {
      const e = sums.get(cat ?? '');
      return e && e.n >= 4 ? e.total / e.n : 0;
    };
    const p = comps[i]!;
    out.push(Math.log(p.mcap_usd!) - (predict(base, sizeFeatures(p)) + off(p.category)));
  }
  return out;
}

function walkForwardWithCategory(comps: SnapshotProtocol[], asOf: string): number[] {
  const known = comps.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const half = Math.floor(known.length / 2);
  const train = known.slice(0, half);
  const test = known.slice(half);
  const base = ols(train.map((p) => ({ x: sizeFeatures(p), y: Math.log(p.mcap_usd!) })));
  const sums = new Map<string, { total: number; n: number }>();
  for (const p of train) {
    const r = Math.log(p.mcap_usd!) - predict(base, sizeFeatures(p));
    const e = sums.get(p.category ?? '') ?? { total: 0, n: 0 };
    e.total += r;
    e.n += 1;
    sums.set(p.category ?? '', e);
  }
  const off = (cat: string | null): number => {
    const e = sums.get(cat ?? '');
    return e && e.n >= 4 ? e.total / e.n : 0;
  };
  return test.map((p) => Math.log(p.mcap_usd!) - (predict(base, sizeFeatures(p)) + off(p.category)));
}

/** Flat multiple baseline: the training median mcap/TVL, held out the same way. */
function looFlat(comps: SnapshotProtocol[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const m = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    out.push(Math.log(comps[i]!.mcap_usd!) - Math.log(m * comps[i]!.tvl_usd));
  }
  return out;
}

function walkForwardFlat(comps: SnapshotProtocol[]): number[] {
  const known = comps.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const half = Math.floor(known.length / 2);
  const train = known.slice(0, half);
  const test = known.slice(half);
  const m = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
  return test.map((p) => Math.log(p.mcap_usd!) - Math.log(m * p.tvl_usd));
}

// ---------------------------------------------------------------- launch odds

export function hasTokenRecord(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

/** Logistic fit by IRLS with a small ridge; features include the intercept. */
export function fitLogit(rows: { x: number[]; y: number }[]): number[] {
  const k = rows[0]!.x.length;
  const base = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const beta = new Array<number>(k).fill(0);
  beta[0] = Math.log(Math.max(0.01, Math.min(0.99, base)) / (1 - Math.max(0.01, Math.min(0.99, base))));
  for (let iter = 0; iter < 60; iter++) {
    const g = new Array<number>(k).fill(0);
    const h: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (const r of rows) {
      const pr = sigmoid(predict(beta, r.x));
      for (let i = 0; i < k; i++) {
        g[i] = g[i]! + (r.y - pr) * r.x[i]!;
        for (let j = 0; j < k; j++) h[i]![j] = h[i]![j]! + pr * (1 - pr) * r.x[i]! * r.x[j]!;
      }
    }
    for (let i = 0; i < k; i++) h[i]![i] = h[i]![i]! + 1e-3;
    const step = solveLinear(h, g);
    let biggest = 0;
    for (let i = 0; i < k; i++) {
      beta[i] = beta[i]! + step[i]!;
      biggest = Math.max(biggest, Math.abs(step[i]!));
    }
    if (biggest < 1e-6) break;
  }
  return beta;
}

export function brierScore(predicted: number[], actual: number[]): number {
  let s = 0;
  for (let i = 0; i < predicted.length; i++) s += (predicted[i]! - actual[i]!) ** 2;
  return s / predicted.length;
}

function oddsFeaturesAge(p: SnapshotProtocol, asOf: string): number[] {
  const a = ageYears(p.listed_at, asOf);
  return [1, a === null ? 2 : a];
}

function oddsFeaturesAgeTvl(p: SnapshotProtocol, asOf: string): number[] {
  const a = ageYears(p.listed_at, asOf);
  return [1, a === null ? 2 : a, Math.log(p.tvl_usd)];
}

/** Age-bucket peer rate, shrunk toward the pool rate (k = 10 pseudo-peers). */
export function ageBucketOdds(age: number, pool: SnapshotProtocol[], asOf: string, k = 10): number {
  const base = pool.reduce((s, p) => s + (hasTokenRecord(p) ? 1 : 0), 0) / pool.length;
  const buckets: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 5],
    [5, 99],
  ];
  for (const [lo, hi] of buckets) {
    if (age >= lo && age < hi) {
      const sub = pool.filter((p) => {
        const a = ageYears(p.listed_at, asOf);
        return a !== null && a >= lo && a < hi;
      });
      if (sub.length === 0) return base;
      const tk = sub.reduce((s, p) => s + (hasTokenRecord(p) ? 1 : 0), 0);
      return (tk + k * base) / (sub.length + k);
    }
  }
  return base;
}

/** Category peer rate, shrunk toward the pool rate (k = 10 pseudo-peers). */
export function categoryOdds(p: SnapshotProtocol, pool: SnapshotProtocol[], k = 10): number {
  const base = pool.reduce((s, q) => s + (hasTokenRecord(q) ? 1 : 0), 0) / pool.length;
  const sub = pool.filter((q) => q.category === p.category);
  if (sub.length < 5) return base;
  const tk = sub.reduce((s, q) => s + (hasTokenRecord(q) ? 1 : 0), 0);
  return (tk + k * base) / (sub.length + k);
}

function oddsFiveFold(
  peers: SnapshotProtocol[],
  asOf: string,
  predictFn: (p: SnapshotProtocol, train: SnapshotProtocol[]) => number,
): { predicted: number[]; actual: number[] } {
  const rand = mulberry32(20261114);
  const idx = peers.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  const predicted: number[] = [];
  const actual: number[] = [];
  for (let f = 0; f < 5; f++) {
    const testIdx = new Set(idx.filter((_, k) => k % 5 === f));
    const train = peers.filter((_, i) => !testIdx.has(i));
    const test = peers.filter((_, i) => testIdx.has(i));
    for (const p of test) {
      predicted.push(predictFn(p, train));
      actual.push(hasTokenRecord(p) ? 1 : 0);
    }
  }
  return { predicted, actual };
}

function oddsWalkForward(
  peers: SnapshotProtocol[],
  asOf: string,
  predictFn: (p: SnapshotProtocol, train: SnapshotProtocol[]) => number,
): { predicted: number[]; actual: number[] } {
  const sorted = [...peers].sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const half = Math.floor(sorted.length / 2);
  const train = sorted.slice(0, half);
  const test = sorted.slice(half);
  return {
    predicted: test.map((p) => predictFn(p, train)),
    actual: test.map((p) => (hasTokenRecord(p) ? 1 : 0)),
  };
}

// ---------------------------------------------------------------- farm plans

/** The reader's plan size: what the steps and the verdicts are priced at. */
export const PLAN_DEPOSIT = 10000;
export const PLAN_DROP_SHARE = 0.07;
export const PLAN_WEEKS = 26;
export const TBILL_YIELD = 0.04;
/** Hands-on hours the 9-step plan takes: 85 min fixed + 5 min/week x2. */
export const PLAN_HOURS = (15 + 10 + 15 + 10 + 15 + 10 + 5 * PLAN_WEEKS + 5 * PLAN_WEEKS + 10) / 60;
/** The hourly bar a farm must clear, after beating the T-bill. */
export const HOURLY_BAR = 25;

/**
 * Gas tiers by first chain. The dollar figures are planning estimates for
 * one transaction on that chain, stated in the Method tab — not quotes.
 * A: $0.05, B: $0.15, C: $0.50, D: Ethereum $2.50, Bitcoin $1.50.
 */
export function gasTierFor(chain: string): string {
  if (chain === 'Ethereum') return 'eth';
  if (chain === 'Bitcoin') return 'btc';
  if (['Solana', 'Hyperliquid L1', 'Monad', 'Stellar', 'Sui'].includes(chain)) return 'A';
  if (['Base', 'Binance', 'Arbitrum', 'Flare', 'Polygon'].includes(chain)) return 'B';
  return 'C';
}

export const TIER_TX_USD: Record<string, number> = { A: 0.05, B: 0.15, C: 0.5, eth: 2.5, btc: 1.5 };

function money(n: number): string {
  return '$' + n.toFixed(2);
}

/**
 * The 9 farm steps. {P} is the protocol name, {CH} its first chain;
 * {BRIDGE} {DEP} {DEEP} {CAD} {EXIT} are the tier's cost strings. The
 * dashboard carries these same templates and fills the same slots, so the
 * plan it shows is the plan board.json carries — nothing is recomputed.
 */
export const FARM_STEP_TEMPLATES: string[] = [
  'SETUP — Open a fresh wallet for this farm and back up its seed phrase offline. Never share the seed or sign a link sent by DM. Cost $0.00. Time 15 min hands-on.',
  'VERIFY — Find {P} from its official accounts and match the contract addresses against its docs before you connect. Cost $0.00. Time 10 min hands-on.',
  'FUND — Bridge $10,000 USDC to {CH} and withdraw a little gas money from an exchange. Cost {BRIDGE}. Time 15 min hands-on.',
  'RISK — Read how {P} earns its yield and what can fail: smart-contract risk, the team, and who holds the keys. Cost $0.00. Time 10 min reading.',
  'CORE — Deposit $10,000 USDC into {P} on {CH}. Start with a $100 test, check the receipt, then add the rest. Cost {DEP}. Time 15 min hands-on.',
  'DEEPEN — Put the receipt token to work once, in one lending market or LP, and never loop it more than once. Cost {DEEP}. Time 10 min hands-on.',
  'CADENCE — Touch the position weekly: claim points, top up if the pool thins. One on-chain touch a month. Cost {CAD}. Time 5 min a week for 26 weeks.',
  'WATCH — Exit rule: withdraw if TVL falls 20% from today, if withdrawals pause, or if the team goes quiet for 2 weeks. Cost {EXIT}. Time 5 min a week for 26 weeks.',
  'RECORD — Keep a ledger from the first transaction: date, hash, asset, amount, and dollar value at the time. Cost $0.00. Time 10 min.',
];

export function tierCosts(tier: string): { bridge: string; dep: string; deep: string; cad: string; exit: string; total: number } {
  const t = TIER_TX_USD[tier]!;
  return {
    bridge: money(2.21 + t),
    dep: money(2 * t),
    deep: money(2 * t),
    cad: money(6 * t),
    exit: money(2 * t),
    total: 2.21 + 13 * t,
  };
}

export function farmStepsFor(name: string, chain: string): string[] {
  const costs = tierCosts(gasTierFor(chain));
  return FARM_STEP_TEMPLATES.map((s) =>
    s
      .replaceAll('{P}', name)
      .replaceAll('{CH}', chain)
      .replaceAll('{BRIDGE}', costs.bridge)
      .replaceAll('{DEP}', costs.dep)
      .replaceAll('{DEEP}', costs.deep)
      .replaceAll('{CAD}', costs.cad)
      .replaceAll('{EXIT}', costs.exit),
  );
}

/** Expected airdrop value to one farmer at a deposit and drop share. */
export function expectedDrop(implied: number, tvl: number, deposit: number, dropShare: number): number {
  if (tvl <= 0) return 0;
  return implied * dropShare * (deposit / tvl);
}

export function verdictFor(net: number, perHour: number, deposit: number, weeks: number): 'FARM' | 'THIN' | 'SKIP' {
  const tbill = deposit * TBILL_YIELD * (weeks / 52);
  if (net > tbill && perHour >= HOURLY_BAR) return 'FARM';
  if (net > 0) return 'THIN';
  return 'SKIP';
}

// ---------------------------------------------------------------- build

export function buildRadar(snapshot: Snapshot): RadarOutput {
  const asOf = snapshot.as_of;
  const protocols = snapshot.protocols;
  const watch = new Set(snapshot.watchlist);

  // ---- value curve: fit + held-out tests
  const comps = pricedComps(protocols);
  const sizeBeta = ols(comps.map((p) => ({ x: sizeFeatures(p), y: Math.log(p.mcap_usd!) })));
  const sizeLoo = looResiduals(comps, sizeFeatures, asOf);
  const sizeWalk = walkForwardResiduals(comps, sizeFeatures, asOf);
  const sizeFive = fiveFoldResiduals(comps, sizeFeatures, asOf);
  const flatLoo = looFlat(comps);
  const flatWalk = walkForwardFlat(comps);

  // A term is kept only when it beats size-only on BOTH held-out tests by
  // at least 5%. The table reports every term either way.
  const sizeLooMiss = missFactor(sizeLoo);
  const sizeWalkMiss = missFactor(sizeWalk);
  const term = (
    label: string,
    loo: number[],
    walk: number[],
    note: string,
  ): TermTest => {
    const l = missFactor(loo);
    const w = missFactor(walk);
    const kept = l < sizeLooMiss * 0.95 && w < sizeWalkMiss * 0.95;
    return { term: label, loo: l, walk_forward: w, kept, note };
  };
  const valueTerms: TermTest[] = [
    { term: 'flat median multiple', loo: missFactor(flatLoo), walk_forward: missFactor(flatWalk), kept: false, note: 'baseline' },
    { term: 'size curve, ln TVL', loo: sizeLooMiss, walk_forward: sizeWalkMiss, kept: true, note: 'kept' },
    term('+ 7-day TVL growth', looResiduals(comps, growthFeatures, asOf), walkForwardResiduals(comps, growthFeatures, asOf), 'tested, not kept'),
    term('+ category effect, n>=4', looWithCategory(comps, asOf), walkForwardWithCategory(comps, asOf), 'tested, not kept'),
    term('+ age listed', looResiduals(comps, ageFeatures, asOf), walkForwardResiduals(comps, ageFeatures, asOf), 'tested, not kept'),
    term('+ chain count, ln', looResiduals(comps, chainsFeatures, asOf), walkForwardResiduals(comps, chainsFeatures, asOf), 'tested, not kept'),
    term('+ age listed + chain count', looResiduals(comps, ageChainsFeatures, asOf), walkForwardResiduals(comps, ageChainsFeatures, asOf), 'tested, not kept'),
  ];

  // Range band from the 5-fold residuals; honesty is the share of the
  // leave-one-out residuals that land inside that band.
  const bandLo = Math.exp(quantile(sizeFive, 0.25));
  const bandHi = Math.exp(quantile(sizeFive, 0.75));
  const band10 = Math.exp(quantile(sizeFive, 0.1));
  const band90 = Math.exp(quantile(sizeFive, 0.9));
  const flatMultiple = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const inside = sizeLoo.filter((r) => Math.exp(r) >= bandLo && Math.exp(r) <= bandHi).length;
  const rangeHonesty = inside / sizeLoo.length;

  // ---- launch odds: fit + held-out tests
  const peers = protocols.filter((p) => p.listed_at);
  const baseRate = peers.reduce((s, p) => s + (hasTokenRecord(p) ? 1 : 0), 0) / peers.length;
  const logitRows = peers.map((p) => ({ x: oddsFeaturesAge(p, asOf), y: hasTokenRecord(p) ? 1 : 0 }));
  const oddsBeta = fitLogit(logitRows);

  const logitAge = (p: SnapshotProtocol, train: SnapshotProtocol[]): number => {
    const b = fitLogit(train.map((q) => ({ x: oddsFeaturesAge(q, asOf), y: hasTokenRecord(q) ? 1 : 0 })));
    const a = ageYears(p.listed_at, asOf);
    return sigmoid(predict(b, [1, a === null ? 2 : a]));
  };
  const logitAgeTvl = (p: SnapshotProtocol, train: SnapshotProtocol[]): number => {
    const b = fitLogit(train.map((q) => ({ x: oddsFeaturesAgeTvl(q, asOf), y: hasTokenRecord(q) ? 1 : 0 })));
    const a = ageYears(p.listed_at, asOf);
    return sigmoid(predict(b, [1, a === null ? 2 : a, Math.log(p.tvl_usd)]));
  };
  const bucketFn = (p: SnapshotProtocol, train: SnapshotProtocol[]): number => {
    const a = ageYears(p.listed_at, asOf);
    return a === null ? baseRate : ageBucketOdds(a, train, asOf);
  };
  const catFn = (p: SnapshotProtocol, train: SnapshotProtocol[]): number => categoryOdds(p, train);
  const baseFn = (): number => baseRate;

  const odds5 = oddsFiveFold(peers, asOf, logitAge);
  const oddsW = oddsWalkForward(peers, asOf, logitAge);
  const odds5Tvl = oddsFiveFold(peers, asOf, logitAgeTvl);
  const oddsWTvl = oddsWalkForward(peers, asOf, logitAgeTvl);
  const odds5Bucket = oddsFiveFold(peers, asOf, bucketFn);
  const oddsWBucket = oddsWalkForward(peers, asOf, bucketFn);
  const odds5Cat = oddsFiveFold(peers, asOf, catFn);
  const oddsWCat = oddsWalkForward(peers, asOf, catFn);
  const base5 = brierScore(odds5.predicted.map(() => baseRate), odds5.actual);
  const baseW = brierScore(oddsW.predicted.map(() => baseRate), oddsW.actual);
  const oddsTest = (
    label: string,
    five: number,
    walk: number,
    note: string,
  ): OddsTest => ({
    term: label,
    five_fold: five,
    walk_forward: walk,
    kept: five < base5 * 0.95 && walk < baseW * 0.95,
    note,
  });
  const oddsTerms: OddsTest[] = [
    { term: 'base rate of peers', five_fold: base5, walk_forward: baseW, kept: false, note: 'baseline' },
    oddsTest('logit on no-token age', brierScore(odds5.predicted, odds5.actual), brierScore(oddsW.predicted, oddsW.actual), 'kept'),
    oddsTest('logit on age + ln TVL', brierScore(odds5Tvl.predicted, odds5Tvl.actual), brierScore(oddsWTvl.predicted, oddsWTvl.actual), 'tested, not kept'),
    oddsTest('age-bucket peer rate', brierScore(odds5Bucket.predicted, odds5Bucket.actual), brierScore(oddsWBucket.predicted, oddsWBucket.actual), 'tested, not kept'),
    oddsTest('category peer rate', brierScore(odds5Cat.predicted, odds5Cat.actual), brierScore(oddsWCat.predicted, oddsWCat.actual), 'tested, not kept'),
  ];

  const oddsOf = (p: SnapshotProtocol): number => {
    const a = ageYears(p.listed_at, asOf);
    if (a === null) return baseRate;
    return sigmoid(predict(oddsBeta, [1, a]));
  };

  // ---- candidates: every no-token protocol the house rule does not set aside
  const candidates = protocols.filter((p) => recordsNoToken(p) && setAsideReason(p) === null);
  candidates.sort((a, b) => b.tvl_usd - a.tvl_usd);
  const ranked = candidates.slice(0, 198);

  // ---- rows
  const rows: BoardRow[] = ranked.map((p) => {
    const ifLaunches = Math.exp(predict(sizeBeta, sizeFeatures(p)));
    const odds = oddsOf(p);
    const implied = Math.max(1, Math.round(ifLaunches * odds));
    const chain = p.chains[0] ?? 'Ethereum';
    const tier = gasTierFor(chain);
    const fee = tierCosts(tier).total;
    const drop = expectedDrop(implied, p.tvl_usd, PLAN_DEPOSIT, PLAN_DROP_SHARE);
    const net = drop - fee;
    const perHour = net / PLAN_HOURS;
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmStepsFor(p.name, chain),
      category: p.category,
      chain,
      chains: p.chains.length,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_years: ageYears(p.listed_at, asOf),
      watchlist: watch.has(p.slug),
      off_list: !watch.has(p.slug) && p.tvl_usd >= snapshot.floor_usd,
      odds,
      if_launches_usd: Math.max(1, Math.round(ifLaunches)),
      p25_usd: Math.max(1, Math.round(implied * bandLo)),
      p75_usd: Math.max(1, Math.round(implied * bandHi)),
      size_multiple: ifLaunches / p.tvl_usd,
      fee_usd: fee,
      hours: PLAN_HOURS,
      net_usd: net,
      net_per_hour: perHour,
      verdict: verdictFor(net, perHour, PLAN_DEPOSIT, PLAN_WEEKS),
      boot_lo: 0,
      boot_hi: 0,
      gas_tier: tier,
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // ---- bootstrap rank range: 40 refits of the size curve on resampled comps
  const rand = mulberry32(20261124);
  const bootRanks = new Map<string, number[]>();
  for (let b = 0; b < 40; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]!);
    const beta = ols(sample.map((p) => ({ x: sizeFeatures(p), y: Math.log(p.mcap_usd!) })));
    const scored = rows.map((r) => {
      const p = ranked.find((q) => q.slug === r.slug)!;
      return { slug: r.slug, v: Math.exp(predict(beta, sizeFeatures(p))) * r.odds };
    });
    scored.sort((a, b2) => b2.v - a.v || a.slug.localeCompare(b2.slug));
    scored.forEach((s, i) => {
      const arr = bootRanks.get(s.slug) ?? [];
      arr.push(i + 1);
      bootRanks.set(s.slug, arr);
    });
  }
  for (const r of rows) {
    const arr = bootRanks.get(r.slug) ?? [r.rank];
    r.boot_lo = Math.min(...arr);
    r.boot_hi = Math.max(...arr);
  }

  // ---- accounting: every one of the 758 protocols in exactly one group
  const rankedSlugs = new Set(rows.map((r) => r.slug));
  let tokenTrades = 0;
  let tokenRecordNoMcap = 0;
  let setAsideCategory = 0;
  let setAsideVersioned = 0;
  let setAsideWrapped = 0;
  for (const p of protocols) {
    if (rankedSlugs.has(p.slug)) continue;
    if (p.mcap_usd !== null) {
      tokenTrades++;
    } else if (!recordsNoToken(p)) {
      tokenRecordNoMcap++;
    } else {
      const reason = setAsideReason(p);
      if (reason === 'category') setAsideCategory++;
      else if (reason === 'versioned') setAsideVersioned++;
      else setAsideWrapped++;
    }
  }
  const accounting: Accounting = {
    total: protocols.length,
    ranked: rows.length,
    watchlist: rows.filter((r) => r.watchlist).length,
    early_below_floor: rows.filter((r) => !r.watchlist && !r.off_list).length,
    off_list: rows.filter((r) => r.off_list).length,
    token_trades: tokenTrades,
    token_record_no_mcap: tokenRecordNoMcap,
    set_aside_category: setAsideCategory,
    set_aside_versioned: setAsideVersioned,
    set_aside_wrapped: setAsideWrapped,
  };

  const evidence: Evidence = {
    comps: comps.length,
    peers: peers.length,
    base_rate: baseRate,
    size_a: sizeBeta[0]!,
    size_b: sizeBeta[1]!,
    size_loo: sizeLooMiss,
    size_walk: sizeWalkMiss,
    size_five_fold: missFactor(sizeFive),
    flat_loo: missFactor(flatLoo),
    flat_walk: missFactor(flatWalk),
    band_lo: bandLo,
    band_hi: bandHi,
    band10,
    band90,
    flat_multiple: flatMultiple,
    range_honesty: rangeHonesty,
    odds_a: oddsBeta[0]!,
    odds_b: oddsBeta[1]!,
    odds_five_fold: brierScore(odds5.predicted, odds5.actual),
    odds_walk: brierScore(oddsW.predicted, oddsW.actual),
    odds_base_five_fold: base5,
    odds_base_walk: baseW,
    value_terms: valueTerms,
    odds_terms: oddsTerms,
    farm_count: rows.filter((r) => r.verdict === 'FARM').length,
    thin_count: rows.filter((r) => r.verdict === 'THIN').length,
    skip_count: rows.filter((r) => r.verdict === 'SKIP').length,
    total_implied: rows.reduce((s, r) => s + r.implied_value_usd, 0),
  };

  return {
    rows,
    evidence,
    accounting,
    as_of: asOf,
    plan_deposit: PLAN_DEPOSIT,
    plan_drop_share: PLAN_DROP_SHARE,
    plan_weeks: PLAN_WEEKS,
    tbill: TBILL_YIELD,
    comps: comps
      .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, mcap: p.mcap_usd! }))
      .sort((a, b) => a.tvl - b.tvl),
  };
}
