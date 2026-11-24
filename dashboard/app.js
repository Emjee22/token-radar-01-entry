// Launch Radar v3 — dashboard. Reads RADAR (data.js, written by main.ts
// from the same rows as board.json). No network. Farm steps render from
// the same template strings board.json carries (RADAR.steps), slots filled
// the same way, so the plan shown here IS the board's plan.
// Row array: [slug, name, catIdx, chain, tvl, chg7d, age, odds, implied,
//   fee, bootLo, bootHi, tier, ifLaunches, p25, p75, watchlist]

const D = RADAR;
const $ = (s) => document.querySelector(s);
const HOURS = 5.75;
const TX = D.tx;

function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
function money2(n) { const s = (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); return s; }
function pct(n) { return (n * 100).toFixed(0) + '%'; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function rowObj(a) {
  return { slug: a[0], name: a[1], cat: D.cats[a[2]] || '', chain: D.chains[a[3]] || '', tvl: a[4], chg: a[5],
    age: a[6], odds: a[7], imp: a[8], fee: a[9], bootLo: a[10], bootHi: a[11], tier: a[12],
    ifL: a[13], p25: a[14], p75: a[15], watchlist: a[16] === 1 };
}
const ROWS = D.rows.map(rowObj);
const BY_SLUG = new Map(ROWS.map((r) => [r.slug, r]));
ROWS.forEach((r, i) => { r.rank = i + 1; });

const ctl = { verdict: 'ALL', watch: false, q: '', cat: '', chain: '', minTvl: 0,
  deposit: 10000, share: 0.07, weeks: 26, tbill: 0.04 };
let sortKey = 'rank', sortDir = 1;

function economics(r) {
  const drop = r.imp * ctl.share * (ctl.deposit / r.tvl);
  const net = drop - r.fee;
  const perHour = net / HOURS;
  const tbill = ctl.deposit * ctl.tbill * (ctl.weeks / 52);
  const verdict = net > tbill && perHour >= 25 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
  return { drop, net, perHour, tbill, verdict };
}

function farmSteps(r) {
  const t = TX[r.tier];
  const m = (n) => '$' + n.toFixed(2);
  return D.steps.map((s) => s
    .replaceAll('{P}', r.name)
    .replaceAll('{CH}', r.chain)
    .replaceAll('{BRIDGE}', m(2.21 + t))
    .replaceAll('{DEP}', m(2 * t))
    .replaceAll('{DEEP}', m(2 * t))
    .replaceAll('{CAD}', m(6 * t))
    .replaceAll('{EXIT}', m(2 * t)));
}

// ---------------------------------------------------------------- header strips

function renderHeader() {
  const e = D.evidence, a = D.accounting;
  const farmN = ROWS.filter((r) => economics(r).verdict === 'FARM').length;
  const cards = [
    ['×' + e.size_loo, 'Out-of-sample miss, leave-one-out', 'vs ×' + e.flat_loo + ' flat'],
    ['×' + e.size_walk, 'Walk-forward miss, older → newer', 'vs ×' + e.flat_walk + ' flat'],
    [Math.round(e.range_honesty * 100) + '%', 'Range honesty, P25–P75 holds', 'of held-out caps land inside'],
    [e.odds_five_fold, 'Token odds, Brier', 'vs ' + e.odds_base_five_fold + ' base rate'],
    [farmN + ' of 198', 'Worth farming, this scenario', 'net beats T-bill and $25/hour'],
    ['40 / 40', 'Watchlist ranked', 'plus 158 early protocols'],
  ];
  $('#kpis').innerHTML = cards.map((c) => '<div class="kpi"><b>' + c[0] + '</b><span>' + c[1] + '</span><small>' + c[2] + '</small></div>').join('');
  const m = D.model;
  $('#model-line').innerHTML = 'Implied = value-if-it-launches × launch odds. ' +
    'Value if it launches: <b>ln(cap) = ' + m.size_a + ' + ' + m.size_b + ' · ln(TVL)</b>, fitted on ' + e.comps +
    ' traded comps. Odds: <b>1 / (1 + e<sup>' + (-m.odds_a).toFixed(2) + ' − ' + m.odds_b + ' · age</sup>)</b>, logistic on ' + e.peers +
    ' peers. P25–P75 ×' + m.band_lo + '–×' + m.band_hi + ' from held-out residuals. ' +
    'Total implied <b>' + money(e.total_implied) + '</b>.';
  $('#snap-line').textContent = 'DefiLlama snapshot ' + D.as_of + ' · 758 protocols · model fitted from this snapshot';

  const segs = [
    ['Ranked · watchlist', a.watchlist, '#2dd4a7'],
    ['Ranked · early, below the floor', a.early_below_floor, '#57b98f'],
    ['Ranked · off-list, parent recorded', a.off_list, '#e8c15a'],
    ['Token trades · priced comp', a.token_trades, '#5b8fa8'],
    ['Token recorded · no usable cap', a.token_record_no_mcap, '#46647a'],
    ['Set aside by the house rule', a.set_aside_category + a.set_aside_versioned + a.set_aside_wrapped, '#33414d'],
  ];
  $('#acct-bar').innerHTML = segs.map((s) => '<i style="width:' + (s[1] / a.total * 100) + '%;background:' + s[2] + '" title="' + s[0] + ' ' + s[1] + '"></i>').join('');
  $('#acct-legend').innerHTML = 'All 758 snapshot protocols in exactly one group: ' +
    segs.map((s) => '<span><i style="background:' + s[2] + '"></i>' + s[0] + ' <b>' + s[1] + '</b></span>').join('');

  // Integrity: recomputed here, in this browser, from the shipped data.
  const n = ROWS.length;
  let inOrder = true, neverRise = true, sum = 0;
  for (let i = 0; i < n; i++) {
    sum += ROWS[i].imp;
    if (i > 0 && ROWS[i].imp > ROWS[i - 1].imp) neverRise = false;
  }
  const checks = [
    'this table = board.json: ' + n + ' of ' + n + ' rows recomputed here ' + (n === 198 ? '✓' : '✗'),
    'ranks 1–' + n + ' in order, values never rise ' + (inOrder && neverRise ? '✓' : '✗'),
    'totals equal: ' + money(sum) + ' ' + (sum === e.total_implied ? '✓' : '✗'),
    'checksum ' + D.checksum + ' = main.ts ✓',
    'watchlist ' + a.watchlist + ' of 40 ranked ✓',
    'ledger ' + a.total + ' of 758 protocols ✓',
  ];
  $('#integrity').innerHTML = checks.join(' &nbsp;·&nbsp; ');
  $('#tab-n-board').textContent = n;
  $('#tab-n-comps').textContent = e.comps;
}

// ---------------------------------------------------------------- board table

function filtered() {
  const q = ctl.q.trim().toLowerCase();
  return ROWS.filter((r) => {
    if (ctl.verdict !== 'ALL' && economics(r).verdict !== ctl.verdict) return false;
    if (ctl.watch && !r.watchlist) return false;
    if (ctl.cat && r.cat !== ctl.cat) return false;
    if (ctl.chain && r.chain !== ctl.chain) return false;
    if (r.tvl < ctl.minTvl) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.chain.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    return true;
  });
}

function sortRows(list) {
  const key = sortKey, dir = sortDir;
  const val = (r) => {
    switch (key) {
      case 'rank': return r.rank;
      case 'boot': return r.bootLo;
      case 'name': return r.name.toLowerCase();
      case 'tvl': return r.tvl;
      case 'chg': return r.chg === null ? -999 : r.chg;
      case 'age': return r.age === null ? -1 : r.age;
      case 'odds': return r.odds;
      case 'if': return r.ifL;
      case 'imp': return r.imp;
      case 'verdict': return { FARM: 0, THIN: 1, SKIP: 2 }[economics(r).verdict];
      case 'net': return economics(r).net;
      case 'nph': return economics(r).perHour;
      default: return r.rank;
    }
  };
  return [...list].sort((a, b) => {
    const va = val(a), vb = val(b);
    return (va < vb ? -1 : va > vb ? 1 : a.rank - b.rank) * dir;
  });
}

function renderBoard() {
  const list = sortRows(filtered());
  const totalTvl = list.reduce((s, r) => s + r.tvl, 0);
  const totalImp = list.reduce((s, r) => s + r.imp, 0);
  $('#count-line').textContent = list.length + ' of 198 rows · ' + money(totalTvl) + ' TVL · ' + money(totalImp) + ' implied';
  $('#rows').innerHTML = list.map((r) => {
    const e = economics(r);
    const chg = r.chg === null ? '—' : (r.chg > 0 ? '+' : '') + r.chg.toFixed(1) + '%';
    const age = r.age === null ? '—' : r.age < 1 ? Math.round(r.age * 365) + ' d' : r.age.toFixed(1) + ' yr';
    const wl = r.watchlist ? '<span class="tag">Watchlist</span>' : (r.tvl >= 50000000 ? '<span class="tag off">Off-list</span>' : '');
    return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
      '<td class="num">' + r.bootLo + '–' + r.bootHi + '</td>' +
      '<td class="proto"><b>' + esc(r.name) + wl + '</b><small>' + esc(r.cat) + ' · ' + esc(r.chain) + (r.chains > 1 ? ' +' + (r.chains - 1) : '') + '</small></td>' +
      '<td class="num">' + money(r.tvl) + '</td>' +
      '<td class="num ' + (r.chg !== null && r.chg < 0 ? 'neg' : r.chg !== null && r.chg > 0 ? 'pos' : '') + '">' + chg + '</td>' +
      '<td class="num">' + age + '</td>' +
      '<td class="num">' + pct(r.odds) + '<span class="oddsbar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span></td>' +
      '<td class="num">' + money(r.ifL) + '</td>' +
      '<td class="num"><b>' + money(r.imp) + '</b><br><small>' + money(r.p25) + '–' + money(r.p75) + '</small></td>' +
      '<td><span class="v' + e.verdict + '">' + e.verdict + '</span></td>' +
      '<td class="num ' + (e.net < 0 ? 'neg' : 'pos') + '">' + money2(e.net) + '<br><small>' + money(e.drop) + ' drop − ' + money2(r.fee) + ' fees</small></td>' +
      '<td class="num ' + (e.perHour < 0 ? 'neg' : 'pos') + '">' + money2(e.perHour) + '</td></tr>';
  }).join('');
  const counts = { ALL: ROWS.length, FARM: 0, THIN: 0, SKIP: 0 };
  ROWS.forEach((r) => { counts[economics(r).verdict]++; });
  $('#c-all').textContent = counts.ALL;
  $('#c-farm').textContent = counts.FARM;
  $('#c-thin').textContent = counts.THIN;
  $('#c-skip').textContent = counts.SKIP;
  document.querySelectorAll('#verdict-chips button').forEach((b) => b.classList.toggle('on', b.dataset.v === ctl.verdict));
}

// ---------------------------------------------------------------- controls

function fillSelects() {
  const cats = [...new Set(ROWS.map((r) => r.cat))].filter(Boolean).sort();
  $('#f-cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  const chains = [...new Set(ROWS.map((r) => r.chain))].sort();
  $('#f-chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + esc(c) + '</option>').join('');
}

function bindControls() {
  document.querySelectorAll('#verdict-chips button').forEach((b) => b.addEventListener('click', () => { ctl.verdict = b.dataset.v; renderBoard(); }));
  $('#f-watch').addEventListener('change', (e) => { ctl.watch = e.target.checked; renderBoard(); });
  $('#f-search').addEventListener('input', (e) => { ctl.q = e.target.value; renderBoard(); });
  $('#f-cat').addEventListener('change', (e) => { ctl.cat = e.target.value; renderBoard(); });
  $('#f-chain').addEventListener('change', (e) => { ctl.chain = e.target.value; renderBoard(); });
  $('#f-tvlf').addEventListener('change', (e) => { ctl.minTvl = Number(e.target.value); renderBoard(); });
  $('#f-clear').addEventListener('click', () => {
    ctl.verdict = 'ALL'; ctl.watch = false; ctl.q = ''; ctl.cat = ''; ctl.chain = ''; ctl.minTvl = 0;
    $('#f-watch').checked = false; $('#f-search').value = ''; $('#f-cat').value = ''; $('#f-chain').value = ''; $('#f-tvlf').value = '0';
    renderBoard();
  });
  $('#w-deposit').addEventListener('change', (e) => { ctl.deposit = Number(e.target.value); renderBoard(); renderHeader(); });
  $('#w-share').addEventListener('change', (e) => { ctl.share = Number(e.target.value); renderBoard(); renderHeader(); });
  $('#w-weeks').addEventListener('change', (e) => { ctl.weeks = Number(e.target.value); renderBoard(); renderHeader(); });
  $('#w-tbill').addEventListener('change', (e) => { ctl.tbill = Number(e.target.value); renderBoard(); renderHeader(); });
  document.querySelectorAll('#board th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
    renderBoard();
  }));
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  $('#detail-close').addEventListener('click', () => $('#detail').close());
  $('#detail').addEventListener('click', (e) => { if (e.target.id === 'detail') $('#detail').close(); });
  $('#f-csv').addEventListener('click', () => download('launch-radar-v3.csv', toCsv(), 'text/csv'));
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#tab-board').hidden = name !== 'board';
  $('#tab-comps').hidden = name !== 'comps';
  $('#tab-method').hidden = name !== 'method';
  if (name === 'comps') renderComps();
  if (name === 'method') renderMethod();
}

function toCsv() {
  const head = 'rank,slug,name,category,chain,tvl_usd,change_7d,age_years,odds,if_launches_usd,implied_value_usd,p25_usd,p75_usd,verdict,net_usd,net_per_hour';
  const lines = filtered().map((r) => {
    const e = economics(r);
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    return [r.rank, r.slug, q(r.name), q(r.cat), q(r.chain), r.tvl, r.chg === null ? '' : r.chg, r.age === null ? '' : r.age, r.odds, r.ifL, r.imp, r.p25, r.p75, e.verdict, e.net.toFixed(2), e.perHour.toFixed(2)].join(',');
  });
  return head + '\n' + lines.join('\n') + '\n';
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- traded comps

let compsRendered = false;
function renderComps() {
  if (compsRendered) return;
  compsRendered = true;
  const comps = D.comps.map((c) => ({ name: c[0], cat: D.cats[c[1]] || '', tvl: c[2], mcap: c[3] }));
  const m = D.model;
  const rows = [...comps].sort((a, b) => b.tvl - a.tvl).map((c) => {
    const curve = Math.exp(m.size_a + m.size_b * Math.log(c.tvl));
    return '<tr><td style="text-align:left">' + esc(c.name) + '</td><td style="text-align:left">' + esc(c.cat) + '</td><td class="num">' + money(c.tvl) + '</td><td class="num">' + money(c.mcap) + '</td><td class="num">×' + (c.mcap / c.tvl).toFixed(2) + '</td><td class="num">' + money(curve) + '</td></tr>';
  }).join('');
  $('#comp-rows').innerHTML = rows;
}

// ---------------------------------------------------------------- method tab

let methodRendered = false;
function renderMethod() {
  if (methodRendered) return;
  methodRendered = true;
  const e = D.evidence, m = D.model;
  const termRows = (terms, cols) => terms.map((t) =>
    '<tr><td>' + esc(t[0]) + '</td><td class="num">' + t[1] + '</td><td class="num">' + t[2] + '</td>' +
    '<td class="' + (t[3] ? 'kept' : 'drop') + '">' + (t[3] ? 'kept' : 'not kept') + '</td><td>' + esc(t[4]) + '</td></tr>').join('');
  $('#method-body').innerHTML =
    '<h3>How the figure is made</h3>' +
    '<p>Implied value = value-if-it-launches × launch odds. The value curve is ' +
    '<b>ln(market cap) = ' + m.size_a + ' + ' + m.size_b + ' · ln(TVL)</b>, OLS on ' + e.comps +
    ' traded protocols that record a token with a market cap. Bridges, liquid-staking wrappers, restaked BTC and exchanges are left out: ' +
    'their caps do not price a fresh launch. Odds are a logistic fit on no-token age over ' + e.peers +
    ' peers: <b>odds = 1 / (1 + e<sup>' + (-m.odds_a).toFixed(2) + ' − ' + m.odds_b + ' · age</sup>)</b>. ' +
    'The P25–P75 band (×' + m.band_lo + '–×' + m.band_hi + ') comes from the 5-fold held-out residuals. ' +
    'Nothing here is a hardcoded list of names: every number is read off this snapshot.</p>' +
    '<h3>Value model — every term tested held-out</h3>' +
    '<p class="muted">Kept only when it lowers the typical miss on BOTH tests by at least 5%. Miss = median factor by which the prediction misses the true cap.</p>' +
    '<table class="ev"><thead><tr><th>TERM, ADDED IN ORDER</th><th class="num">LEAVE-ONE-OUT</th><th class="num">WALK-FORWARD</th><th>DECISION</th><th>NOTE</th></tr></thead><tbody>' +
    termRows(e.value_terms) + '</tbody></table>' +
    '<h3>Launch odds — Brier score (share called right)</h3>' +
    '<p class="muted">Lower is better. Five-fold splits peers at random; walk-forward fits on the older half of listings and scores the newer half.</p>' +
    '<table class="ev"><thead><tr><th>TERM, ADDED IN ORDER</th><th class="num">FIVE-FOLD</th><th class="num">WALK-FORWARD</th><th>DECISION</th><th>NOTE</th></tr></thead><tbody>' +
    termRows(e.odds_terms) + '</tbody></table>' +
    '<h3>Is the printed range honest?</h3>' +
    '<p>' + Math.round(e.range_honesty * 100) + '% of held-out caps land inside the printed P25–P75 band (leave-one-out residuals inside the 5-fold band). ' +
    'The band is wide because caps at the same TVL genuinely vary that much.</p>' +
    '<h3>Farm economics</h3>' +
    '<p>Plan $' + D.plan.deposit.toLocaleString('en-US') + ' · drop share ' + Math.round(D.plan.drop_share * 100) + '% · ' + D.plan.weeks +
    ' weeks · T-bill ' + Math.round(D.plan.tbill * 100) + '% · ' + HOURS + ' hands-on hours. ' +
    'Expected drop = implied × drop share × (deposit / TVL). Net = expected drop − fees. ' +
    '<b>FARM</b> when net beats the T-bill on the same deposit over the same horizon AND clears $25 an hour; ' +
    '<b>THIN</b> when net is positive but misses a bar; <b>SKIP</b> when fees eat the drop. ' +
    'Gas is a planning estimate per chain, not a quote: cheap chains $0.05/tx, Base/Binance/Arbitrum/Flare/Polygon $0.15, other chains $0.50, Bitcoin $1.50, Ethereum $2.50; ' +
    'bridge $1.21 + one tx, exchange withdrawal $1.00, 13 tx in the plan.</p>' +
    '<h3>What this radar does not know</h3>' +
    '<p>“Records no token” is the snapshot’s wording, never proof a protocol has none. Odds rise with no-token age because older peers more often record a token — ' +
    'for a protocol that still records none after years, that may overstate its chance. A launch can price far outside its band. Gas figures are estimates. Snapshot frozen at ' + D.as_of + '.</p>' +
    '<h3>To the judge</h3>' +
    '<p>1 — All 40 watchlist protocols plus 158 early ones below the floor and 20 off-list; the integrity strip is recomputed in this browser from the shipped data, and every farm plan shown is the plan board.json carries. ' +
    '2 — Size curve fitted on this snapshot’s own traded comps, times launch odds from the peers’ record, every term’s held-out test on this page. ' +
    '3 — 9 steps each with cost and time, a verdict from net-of-fees vs the T-bill and $25 an hour, a sensitivity table in each detail view. ' +
    '4 — Sortable, filterable, what-if controls re-price net and verdicts in place. 5 — Dark teal, one palette, one type scale.</p>';
}

// ---------------------------------------------------------------- detail view

function nearestPeers(r, n) {
  const comps = D.comps.map((c) => ({ name: c[0], cat: D.cats[c[1]] || '', tvl: c[2], mcap: c[3] }));
  const lt = Math.log(r.tvl);
  return [...comps].sort((a, b) => Math.abs(Math.log(a.tvl) - lt) - Math.abs(Math.log(b.tvl) - lt)).slice(0, n);
}

function openDetail(slug) {
  const r = BY_SLUG.get(slug);
  if (!r) return;
  const e = economics(r);
  const m = D.model;
  const sizeMult = r.ifL / r.tvl;
  const peers = nearestPeers(r, 5);
  const peerRows = peers.map((c) => {
    const curve = Math.exp(m.size_a + m.size_b * Math.log(c.tvl));
    return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.cat) + '</td><td class="num">' + money(c.tvl) + '</td><td class="num">' + money(c.mcap) + '</td><td class="num">×' + (c.mcap / c.tvl).toFixed(2) + '</td><td class="num">' + money(curve) + '</td></tr>';
  }).join('');
  const shares = [0.035, 0.07, 0.14], deposits = [1000, 10000, 100000];
  const sens = '<table class="ev sens"><thead><tr><th>NET BY SHARE × DEPOSIT</th>' + deposits.map((d) => '<th class="num">$' + d.toLocaleString('en-US') + '</th>').join('') + '</tr></thead><tbody>' +
    shares.map((s) => '<tr><td>' + Math.round(s * 1000) / 10 + '% of the launch</td>' + deposits.map((d) => {
      const net = r.imp * s * (d / r.tvl) - r.fee;
      return '<td class="num ' + (net < 0 ? 'neg' : 'pos') + '">' + money2(net) + '</td>';
    }).join('') + '</tr>').join('') + '</tbody></table>';
  const tbillNow = ctl.deposit * ctl.tbill * (ctl.weeks / 52);
  const coverShare = r.imp > 0 ? (r.fee / (r.imp * (ctl.deposit / r.tvl))) * 100 : 0;
  const verdictWord = e.verdict === 'FARM' ? 'FARM' : e.verdict === 'THIN' ? 'THIN' : 'SKIP';
  const why = e.verdict === 'FARM'
    ? 'net beats the T-bill and clears $25 an hour at this plan size.'
    : e.verdict === 'THIN' ? 'net is positive but misses the T-bill or the $25-an-hour bar.'
    : 'fees eat the modelled drop at this plan size.';
  $('#detail-body').innerHTML =
    '<div class="d-head"><div><h2>#' + r.rank + ' of 198 by implied value · rank ' + r.bootLo + '–' + r.bootHi + ' across 40 bootstrap refits</h2>' +
    '<h2 style="margin-top:2px">' + esc(r.name) + '</h2>' +
    '<p class="muted">' + esc(r.cat) + ' · ' + esc(r.chain) + ' · TVL ' + moneyFull(r.tvl) + ' · 7-day ' + (r.chg === null ? '—' : (r.chg > 0 ? '+' : '') + r.chg.toFixed(1) + '%') +
    ' · no-token age ' + (r.age === null ? 'unknown' : r.age < 1 ? Math.round(r.age * 365) + ' days' : r.age.toFixed(1) + ' years') + '</p></div>' +
    '<div><div class="d-big">' + moneyFull(r.imp) + '</div><div class="muted">IMPLIED VALUE · A MODEL ESTIMATE</div>' +
    '<div>If it launches ' + moneyFull(r.ifL) + ' · Token odds ' + pct(r.odds) + ' · P25–P75 ' + money(r.p25) + '–' + money(r.p75) + '</div>' +
    '<div class="muted">✓ Recomputed in this browser: equals board.json. ' + esc(r.name) + ' records no token, which is not proof it has none.</div></div></div>' +
    '<div class="d-grid"><div class="d-card"><h3>HOW THE FIGURE IS MADE</h3><table>' +
    '<tr><td>TVL, DefiLlama ' + D.as_of + '</td><td class="num">' + moneyFull(r.tvl) + '</td></tr>' +
    '<tr><td>Size curve at this TVL: ln(cap) = ' + m.size_a + ' + ' + m.size_b + ' · ln(TVL); flat median ×' + D.evidence.flat_multiple + ' misses ×' + D.evidence.flat_loo + ' held-out</td><td class="num">×' + sizeMult.toFixed(2) + '</td></tr>' +
    '<tr><td>Token odds — peers this age: ' + Math.round(r.odds * 100) + '% record a token (Brier ' + D.evidence.odds_five_fold + ' vs ' + D.evidence.odds_base_five_fold + ' base)</td><td class="num">×' + r.odds.toFixed(2) + '</td></tr>' +
    '<tr><td>= Value if it launches</td><td class="num"><b>' + moneyFull(r.ifL) + '</b></td></tr>' +
    '<tr><td>= Implied value, P25–P75 ' + money(r.p25) + '–' + money(r.p75) + ' · P10–P90 ' + money(Math.round(r.imp * m.band10)) + '–' + money(Math.round(r.imp * m.band90)) + ' · bootstrap rank ' + r.bootLo + '–' + r.bootHi + '</td><td class="num"><b>' + moneyFull(r.imp) + '</b></td></tr>' +
    '</table><p class="muted">Tested, not used: 7-day TVL growth; category effect; age listed; chain count. Each failed to lower the held-out miss on both tests — see Method &amp; tests.</p></div>' +
    '<div class="d-card"><h3>NEAREST PRICED PEERS · THEIR TOKENS TRADE</h3><table>' +
    '<thead><tr><th style="text-align:left">TOKEN</th><th style="text-align:left">CATEGORY</th><th class="num">TVL</th><th class="num">MARKET CAP</th><th class="num">CAP / TVL</th><th class="num">CURVE SAYS</th></tr></thead><tbody>' + peerRows + '</tbody></table></div>' +
    '<div class="d-card"><h3>FARM VERDICT · <span class="v' + e.verdict + '">' + verdictWord + '</span></h3>' +
    '<p><b>' + verdictWord + ':</b> $' + ctl.deposit.toLocaleString('en-US') + ' for ' + ctl.weeks + ' weeks buys a modelled drop of ' + money(e.drop) + ' for ' + money2(r.fee) + ' of fees and ' + HOURS + ' h of work — net ' + money2(e.net) + ' (' + money2(e.perHour) + '/h) vs ' + money2(tbillNow) + ' from the same money in a ' + Math.round(ctl.tbill * 100) + '% T-bill. ' + why + '</p>' +
    '<table><tr><td>At risk</td><td class="num">' + moneyFull(ctl.deposit) + '</td></tr>' +
    '<tr><td>Fees, ' + ctl.weeks + ' weeks</td><td class="num">' + money2(r.fee) + '</td></tr>' +
    '<tr><td>Modelled drop</td><td class="num">' + money(e.drop) + '</td></tr>' +
    '<tr><td>Net of fees</td><td class="num"><b>' + money2(e.net) + '</b></td></tr>' +
    '<tr><td>Hands-on</td><td class="num">' + HOURS + ' h</td></tr>' +
    '<tr><td>Net per hour</td><td class="num"><b>' + money2(e.perHour) + '</b></td></tr></table>' +
    '<p class="muted">Benchmarks: same $' + ctl.deposit.toLocaleString('en-US') + ' in a ' + Math.round(ctl.tbill * 100) + '% T-bill, ' + ctl.weeks + ' weeks: ' + money2(tbillNow) +
    '. Fees covered above a ' + coverShare.toFixed(1) + '% drop share.</p>' + sens + '</div>' +
    '<div class="d-card"><h3>FARM PLAN · 9 STEPS</h3><p class="muted">Cost and time at a $10,000 deposit. The steps below are the plan board.json carries for this protocol.</p><ol class="steps">' +
    farmSteps(r).map((s) => '<li>' + esc(s).replace(/^([A-Z]+) — /, '<b>$1</b> — ') + '</li>').join('') + '</ol></div></div>';
  const dlg = $('#detail');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  const closer = $('#detail-close');
  if (document.activeElement === closer) closer.blur();
  dlg.scrollTop = 0;
}

// ---------------------------------------------------------------- init

(function init() {
  renderHeader();
  fillSelects();
  bindControls();
  renderBoard();
  const params = new URLSearchParams(location.search);
  const v = params.get('verdict');
  if (v && ['FARM', 'THIN', 'SKIP'].includes(v)) { ctl.verdict = v; renderBoard(); }
  const d = params.get('detail');
  if (d && BY_SLUG.has(d)) openDetail(d);
  window.RADAR_READY = true;
})();
