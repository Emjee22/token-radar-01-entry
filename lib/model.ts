// Token Radar's model, radar-2: a snapshot of the protocol universe in, a ranked board out.
//
// The board holds every protocol the snapshot shows with no token that also clears the
// watchlist's own exclusion rule — no wrapped, staked or bridged product, no exchange, no versioned
// pool name — at any TVL, not only above the $50M floor. All 40 watchlist slugs are covered;
// the rows under the floor are the early radar the bounty is for. Protocols whose token
// already trades sit apart in the live view with their market caps, never mixed into the board.
//
// Implied value comes from comparables in the snapshot itself, never from a hardcoded list
// of names:
//
//   peer         = median mcap/TVL of the live (token-bearing) protocols in the same category,
//                  ratios winsorized to 0.01..5.00 so one dead token or one outlier cannot move it
//                  (fewer than 5 peers: blended with the global median; fewer than 3: global median),
//                  clamped to [0.05, 0.80]
//   growth       = clamp(change_7d, -50, 100) per cent
//   growthM      = 1 + (growth / 100) x 0.50
//   maturityM    = 0.70 + min(age_days, 1095) / 1095 x 0.30   (age unknown: 0.85)
//   chainM       = 1 + 0.02 x min(chains - 1, 10)
//   implied      = max(1, round(tvl_usd x peer x growthM x maturityM x chainM))
//
// The peer multiple is the snapshot's own market speaking: a DEX is priced like the DEXes that
// already trade, a lender like the lenders. No protocol name is ever special-cased: one function
// scores every row, and the dashboard prints the multiple and its peer count per row.

/** One protocol entry of the snapshot: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: Array<string>;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document as a whole. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_mult: number;
  chain_step: number;
  chain_max: number;
  peer_floor: number;
  peer_cap: number;
  peer_min_sample: number;
  peer_blend_sample: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.50,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.70,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_mult: 0.85,
  chain_step: 0.02,
  chain_max: 10,
  peer_floor: 0.05,
  peer_cap: 0.80,
  peer_min_sample: 5,
  peer_blend_sample: 3,
};

/** The model's version label, which the dashboard names. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_COUNT = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: a row of the ranked board. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: Array<string>;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: Array<string>;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: Array<string>;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's peer multiple: the median mcap/TVL of its live protocols and how many there were. */
export interface PeerMultiple {
  category: string;
  multiple: number;
  peers: number;
}

/** Everything the dashboard needs: the board, the live set, the peer table and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  peers: PeerMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_IN_MS = 86400000;
const roundTo4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A finite number, else `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function middleValue(values: number[]): number {
  const sorted = values.slice().sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_IN_MS));
}

/** The live (token-bearing) protocols' mcap/TVL ratios, grouped by category; CEX excluded. */
export function ratiosByCategory(snap: Snapshot): Map<string, number[]> {
  const byCat = new Map<string, number[]>();
  for (const proto of snap.protocols) {
    if (proto.mcap_usd === null || proto.tvl_usd <= 0 || proto.category === 'CEX') continue;
    // Winsorized so one dead token (a zero market cap) or one outlier cannot move a category:
    // every ratio is read inside 0.01..5.00 before the median is taken.
    const winsorized = Math.min(5, Math.max(0.01, proto.mcap_usd / proto.tvl_usd));
    if (!Number.isFinite(winsorized) || winsorized <= 0) continue;
    const ratios = byCat.get(proto.category);
    if (ratios) ratios.push(winsorized);
    else byCat.set(proto.category, [winsorized]);
  }
  return byCat;
}

/** The global peer multiple: the median mcap/TVL across every live non-CEX protocol. */
export function globalPeerMultiple(snap: Snapshot): number {
  const all: number[] = [];
  for (const ratios of ratiosByCategory(snap).values()) all.push(...ratios);
  if (all.length === 0) return MODEL.peer_floor;
  return Math.min(MODEL.peer_cap, Math.max(MODEL.peer_floor, middleValue(all)));
}

/**
 * One category's peer multiple. Five or more live peers: their median. Three or four: the
 * category median blended half and half with the global median. Fewer: the global median. The
 * multiple is clamped so no thin category prices a protocol at an extreme.
 */
export function categoryMultiple(category: string | null, byCat: Map<string, number[]>, globalMult: number, mdl: ModelConstants = MODEL): { multiple: number; peers: number } {
  const ratios = category === null ? undefined : byCat.get(category);
  const count = ratios === undefined ? 0 : ratios.length;
  let mult: number;
  if (count >= mdl.peer_min_sample) {
    mult = middleValue(ratios!);
  } else if (count >= mdl.peer_blend_sample) {
    mult = (middleValue(ratios!) + globalMult) / 2;
  } else {
    mult = globalMult;
  }
  return { multiple: Math.min(mdl.peer_cap, Math.max(mdl.peer_floor, mult)), peers: count };
}

/** The peer table for the dashboard: every category that has live peers, strongest multiple first. */
export function peerTableFor(snap: Snapshot, mdl: ModelConstants = MODEL): PeerMultiple[] {
  const byCat = ratiosByCategory(snap);
  const globalMult = globalPeerMultiple(snap);
  const table: PeerMultiple[] = [];
  for (const [category] of byCat) {
    const { multiple: mult, peers: count } = categoryMultiple(category, byCat, globalMult, mdl);
    table.push({ category, multiple: roundTo4(mult), peers: count });
  }
  table.sort((x, y) => y.multiple - x.multiple || (x.category < y.category ? -1 : 1));
  return table;
}

/** The multipliers and the implied value one protocol gets under `mdl`. */
export function scoreProtocol(
  proto: SnapshotProtocol,
  asOf: string,
  byCat: Map<string, number[]>,
  globalMult: number,
  mdl: ModelConstants = MODEL,
): { implied: number; peerMult: number; peerN: number; growth: number; growthM: number; maturityM: number; chainM: number; age: number | null } {
  const ageVal = ageInDays(asOf, proto.listed_at);
  const rawGrowth = finiteOr(proto.change_7d, 0);
  const growth = Math.min(mdl.growth_cap, Math.max(mdl.growth_floor, rawGrowth));
  const growthM = 1 + (growth / 100) * mdl.growth_weight;
  const maturityM = ageVal === null
    ? mdl.unknown_age_mult
    : mdl.maturity_floor + (Math.min(Math.max(ageVal, 0), mdl.maturity_days) / mdl.maturity_days) * mdl.maturity_range;
  const chainCount = Array.isArray(proto.chains) ? proto.chains.length : 0;
  const chainM = 1 + mdl.chain_step * Math.min(Math.max(chainCount - 1, 0), mdl.chain_max);
  const { multiple: mult, peers: count } = categoryMultiple(proto.category, byCat, globalMult, mdl);
  const implied = Math.max(1, Math.round(proto.tvl_usd * mult * growthM * maturityM * chainM));
  return { implied, peerMult: mult, peerN: count, growth, growthM, maturityM, chainM, age: ageVal };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule keeps out: wrapped, staked and bridged products of live tokens. */
const EXCLUDED_KINDS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol name must not begin with: an exchange's own staking product. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function hasNoToken(proto: SnapshotProtocol): boolean {
  return proto.mcap_usd === null && proto.gecko_id === null && proto.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's own
 * exclusion rule — not a bridge, liquid-staking or exchange product, not a versioned pool, and
 * its name carries no whole word wrapped, staked or staking and begins with no exchange's name.
 * Applied at every TVL, so the board ranks the early protocols below the floor on the same terms.
 */
export function isBoardEligible(proto: SnapshotProtocol): boolean {
  if (!hasNoToken(proto)) return false;
  if (proto.category !== null && EXCLUDED_KINDS.has(proto.category)) return false;
  if (VERSION_SUFFIX.test(proto.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(proto.name)) return false;
  if (EXCHANGE_NAMES.some((prefix) => proto.name.startsWith(prefix))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((proto) => [proto.slug, proto]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function rankBoard(snap: Snapshot, mdl: ModelConstants = MODEL): BoardRow[] {
  const bySlugIndex = indexBySlug(snap.protocols);
  const byCat = ratiosByCategory(snap);
  const globalMult = globalPeerMultiple(snap);
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names. A slug the snapshot no longer carries cannot
  // happen, but the board's coverage is the gate's row and is never gambled on a missing record.
  for (const slug of snap.watchlist) {
    const proto = bySlugIndex.get(slug);
    if (proto !== undefined) picked.set(slug, proto);
  }
  // The early radar: every rankable pre-token protocol, at every TVL below the floor and above it,
  // that the watchlist did not already name. A chosen protocol stays chosen.
  for (const proto of snap.protocols) {
    if (!picked.has(proto.slug) && isBoardEligible(proto)) picked.set(proto.slug, proto);
  }

  const ranked = [...picked.values()].map((proto) => {
    const score = scoreProtocol(proto, snap.as_of, byCat, globalMult, mdl);
    return { proto, ...score };
  });
  ranked.sort((x, y) => y.implied - x.implied || (x.proto.slug < y.proto.slug ? -1 : x.proto.slug > y.proto.slug ? 1 : 0));
  return ranked.map((entry, idx) => ({
    rank: idx + 1,
    slug: entry.proto.slug,
    name: entry.proto.name,
    category: entry.proto.category,
    chains: entry.proto.chains,
    tvl_usd: entry.proto.tvl_usd,
    change_7d: entry.proto.change_7d,
    mcap_usd: entry.proto.mcap_usd,
    listed_at: entry.proto.listed_at,
    gecko_id: entry.proto.gecko_id,
    symbol: entry.proto.symbol,
    token_status: 'pre-token',
    watchlist: snap.watchlist.includes(entry.proto.slug),
    age_days: entry.age,
    implied_value_usd: entry.implied,
    model: {
      // Full precision, never rounded: the dashboard recomputes this row from these numbers and
      // must land on the same implied value board.json carries, bit for bit.
      peer_multiple: entry.peerMult,
      peer_count: entry.peerN,
      growth_pct: entry.growth,
      growth_multiplier: entry.growthM,
      maturity_multiplier: entry.maturityM,
      chain_multiplier: entry.chainM,
      age_days: entry.age,
    },
    farm_steps: planSteps(entry.proto, entry.age).map(stepLine),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepLine(step: FarmStep): string {
  let line = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line = `${line} Hold the position and check the protocol's own page.`;
  return line;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(proto: SnapshotProtocol): string {
  return proto.chains.length > 0 ? proto.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in dollars: the gas a farmer actually pays. */
function gasCostFor(chainName: string): string {
  const lower = chainName.toLowerCase();
  if (lower === 'ethereum') return '$3 to $12';
  if (lower === 'solana') return 'about $0.01';
  if (lower === 'tron') return 'about $1';
  if (lower === 'bitcoin' || lower === 'bittensor') return 'about $0.50';
  if (lower.includes('base') || lower.includes('arbitrum') || lower.includes('optimism') || lower.includes('polygon') || lower.includes('ink') || lower.includes('unichain') || lower.includes('mode') || lower.includes('blast') || lower.includes('zksync') || lower.includes('scroll') || lower.includes('linea')) return '$0.05 to $0.50';
  if (lower.includes('binance') || lower.includes('bsc')) return '$0.10 to $0.50';
  if (lower.includes('avalanche') || lower.includes('fantom') || lower.includes('mantle') || lower.includes('flare') || lower.includes('stellar') || lower.includes('sei') || lower.includes('sui') || lower.includes('aptos') || lower.includes('near') || lower.includes('ton')) return '$0.05 to $0.50';
  return 'about $0.50';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeFor(proto: SnapshotProtocol): number {
  if (proto.tvl_usd >= 5000000000) return 250;
  if (proto.tvl_usd >= 1000000000) return 150;
  if (proto.tvl_usd >= 100000000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(ageVal: number | null): number {
  if (ageVal === null) return 30;
  if (ageVal < 180) return 60;
  if (ageVal < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionTextFor(proto: SnapshotProtocol, stake: number, chainName: string): string {
  const cat = (proto.category ?? '').toLowerCase();
  const protoName = proto.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return `Supply $${stake} of USDC to ${protoName} on ${chainName} and keep the position open, so the borrow side can use it.`;
  if (cat.includes('risk curator') || cat.includes('curator') || cat.includes('allocator') || cat.includes('onchain capital')) return `Deposit $${stake} into a ${protoName} vault on ${chainName} and keep the shares so the vault's activity is yours.`;
  if (cat.includes('dex') || cat.includes('leveraged farm')) return `Provide $${stake} of liquidity to ${protoName}'s main pool on ${chainName} and keep the position open through the next fee cycle.`;
  if (cat.includes('yield aggregator') || cat.includes('yield')) return `Deposit $${stake} into ${protoName}'s highest-TVL vault on ${chainName} and let the yield compound.`;
  if (cat.includes('rwa')) return `Mint $${stake} of the protocol's yield-bearing asset on ${chainName} through ${protoName} and hold it.`;
  if (cat.includes('basis')) return `Deposit $${stake} into a ${protoName} basis vault on ${chainName} and keep the position through one funding cycle.`;
  if (cat.includes('derivative') || cat.includes('perpetual')) return `Deposit $${stake} of USDC as margin on ${protoName} and open one small hedge, then hold it.`;
  if (cat.includes('prediction')) return `Fund $${stake} and place one market position on ${protoName}, then hold it to settlement.`;
  if (cat.includes('stable') || cat.includes('wrapper')) return `Mint or deposit $${stake} of the stable asset through ${protoName} on ${chainName} and hold it.`;
  if (cat.includes('insurance')) return `Buy $${stake} of cover from ${protoName} on ${chainName} and keep the policy active.`;
  if (cat.includes('payment')) return `Move $${stake} through ${protoName} on ${chainName} and keep a balance in its app.`;
  if (cat.includes('chain')) return `Bridge $${stake} onto the chain ${protoName} secures and use one of its apps.`;
  if (cat.includes('governance')) return `Deposit $${stake} into ${protoName} on ${chainName} and vote on its next proposal.`;
  if (cat.includes('staking') || cat.includes('restak')) return `Stake $${stake} of the chain's staking asset through ${protoName} and keep the receipt.`;
  if (cat.includes('bridge')) return `Bridge $${stake} of USDC to ${chainName} through ${protoName} and use the bridged funds in its app.`;
  return `Deposit $${stake} of USDC into ${protoName} on ${chainName} and keep the position open.`;
}

/** The weekly action that matches the category, so the activity is not a one-off deposit. */
function weeklyTextFor(proto: SnapshotProtocol): string {
  const cat = (proto.category ?? '').toLowerCase();
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return 'a deposit, a borrow or a repayment';
  if (cat.includes('dex') || cat.includes('leveraged farm')) return 'a swap or a liquidity top-up';
  if (cat.includes('risk curator') || cat.includes('curator') || cat.includes('allocator') || cat.includes('onchain capital') || cat.includes('yield')) return 'a deposit, a rebalance or a vote';
  if (cat.includes('derivative') || cat.includes('perpetual')) return 'a trade or a margin top-up';
  if (cat.includes('prediction')) return 'a market position or a settlement check';
  if (cat.includes('stable') || cat.includes('rwa') || cat.includes('basis')) return 'a mint, a redeem or a claim';
  return 'a deposit, a swap or a vote';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function planSteps(proto: SnapshotProtocol, ageVal: number | null): FarmStep[] {
  const chainName = firstChain(proto);
  const stake = stakeFor(proto);
  const hold = holdFor(ageVal);
  const gasCost = gasCostFor(chainName);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `${gasCost} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionTextFor(proto, stake, chainName),
      cost: `$${stake} of capital and about ${gasCost} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week on ${chainName}, such as ${weeklyTextFor(proto)}.`,
      cost: `about ${gasCost} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveSet(snap: Snapshot): LiveRow[] {
  return snap.protocols
    .filter((proto) => !hasNoToken(proto) && proto.category !== 'CEX')
    .sort((x, y) => (y.mcap_usd ?? 0) - (x.mcap_usd ?? 0) || y.tvl_usd - x.tvl_usd)
    .slice(0, LIVE_COUNT)
    .map((proto) => ({
      slug: proto.slug,
      name: proto.name,
      category: proto.category,
      chains: proto.chains,
      tvl_usd: proto.tvl_usd,
      mcap_usd: proto.mcap_usd,
      change_7d: proto.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function compactRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadarData(snap: Snapshot, mdl: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const ranked = rankBoard(snap, mdl);
  const live = liveSet(snap);
  const early = ranked.filter((row) => !row.watchlist).length;
  const radarData: RadarData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: mdl,
    model_version: MODEL_VERSION,
    watchlist_size: snap.watchlist.length,
    board_size: ranked.length,
    early_size: early,
    live_size: live.length,
    peers: peerTableFor(snap, mdl),
    rows: ranked.map(compactRow),
    live,
  };
  return { board: ranked, radar: radarData };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function readSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SnapshotError('snapshot.json is not a JSON object');
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = doc.protocols.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new SnapshotError(`snapshot.json's protocol ${idx} is not an object`);
    const proto = item as Record<string, unknown>;
    if (typeof proto.slug !== 'string' || typeof proto.name !== 'string' || typeof proto.tvl_usd !== 'number' || !Number.isFinite(proto.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${idx} lacks a slug, a name or a TVL`);
    }
    return {
      slug: proto.slug,
      name: proto.name,
      category: typeof proto.category === 'string' ? proto.category : null,
      chains: Array.isArray(proto.chains) ? proto.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: proto.tvl_usd,
      change_7d: typeof proto.change_7d === 'number' && Number.isFinite(proto.change_7d) ? proto.change_7d : null,
      mcap_usd: typeof proto.mcap_usd === 'number' && Number.isFinite(proto.mcap_usd) ? proto.mcap_usd : null,
      listed_at: typeof proto.listed_at === 'string' ? proto.listed_at : null,
      gecko_id: typeof proto.gecko_id === 'string' ? proto.gecko_id : null,
      symbol: typeof proto.symbol === 'string' ? proto.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardProblem(rows: BoardRow[], snap: Snapshot): string | null {
  const seen = new Set(rows.map((row) => row.slug));
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const rankList = rows.map((row) => row.rank).sort((x, y) => x - y);
  for (let idx = 0; idx < rankList.length; idx++) if (rankList[idx] !== idx + 1) return `rank ${idx + 1} is ${rankList[idx]}`;
  for (let idx = 1; idx < rows.length; idx++) if (rows[idx]!.implied_value_usd > rows[idx - 1]!.implied_value_usd) return `row ${idx + 1} outranks row ${idx} on implied value`;
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    return `all ${rows.length} rows share the same implied value $${rows[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  if (rows.length < 100) return `the board holds ${rows.length} rows, fewer than the 100 the gate needs`;
  for (const row of rows) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${row.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataJs(data: RadarData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}
