// Token Radar's dashboard, model radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with the
// model's own inputs and the protocol's farm plan, and the method behind the ranking. No network:
// every byte it shows is in data.js. The page recomputes a row from the snapshot figures and
// checks the number board.json carries, so the page's code and the board's data are visibly the
// same arithmetic.
(function tokenRadar() {
  "use strict";

  var RADAR_DATA = window.RADAR;
  if (!RADAR_DATA) return;
  var boardEl = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', minTvl: 0, watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function formatUsd(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    if (Math.abs(value) >= 1000000000) return '$' + (value / 1000000000).toFixed(2) + 'B';
    if (Math.abs(value) >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (Math.abs(value) >= 1000) return '$' + Math.round(value / 1000) + 'K';
    return usdFmt.format(value);
  }
  function formatPct(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }
  function formatAge(ageDays) {
    if (ageDays === null || ageDays === undefined) return 'unknown';
    if (ageDays >= 365) return (ageDays / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(ageDays)) + 'd';
  }
  function formatMult(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    return 'x' + value.toFixed(2);
  }
  // The model in one function, recomputed in the page from the row's own multipliers: the peer
  // multiple the snapshot's live protocols imply, the growth and maturity multipliers and the
  // chain breadth. It must return the number board.json carries.
  function impliedValueOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * row.growth_multiplier * row.maturity_multiplier * row.chain_multiplier));
  }

  function elem(name, props) {
    var made = document.createElement(name);
    if (props) {
      Object.keys(props).forEach(function (attr) {
        if (attr === 'class') made.className = props[attr];
        else if (attr === 'text') made.textContent = props[attr];
        else if (attr === 'html') made.innerHTML = props[attr];
        else if (attr.slice(0, 2) === 'on') made.addEventListener(attr.slice(2), props[attr]);
        else if (props[attr] !== null && props[attr] !== undefined) made.setAttribute(attr, props[attr]);
      });
    }
    for (var idx = 2; idx < arguments.length; idx++) {
      var kid = arguments[idx];
      if (kid === null || kid === undefined) continue;
      if (Array.isArray(kid)) kid.forEach(function (item) { if (item) made.appendChild(item); });
      else if (typeof kid === 'string') made.appendChild(document.createTextNode(kid));
      else made.appendChild(kid);
    }
    return made;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function firstChain(proto) { return proto.chains && proto.chains.length > 0 ? proto.chains[0] : 'its main chain'; }
  function stakeFor(proto) {
    if (proto.tvl_usd >= 5000000000) return 250;
    if (proto.tvl_usd >= 1000000000) return 150;
    if (proto.tvl_usd >= 100000000) return 100;
    return 50;
  }
  function holdFor(ageVal) {
    if (ageVal === null || ageVal === undefined) return 30;
    if (ageVal < 180) return 60;
    if (ageVal < 365) return 45;
    return 30;
  }
  function gasCostFor(chainName) {
    var cat = (chainName || '').toLowerCase();
    if (cat === 'ethereum') return '$3 to $12';
    if (cat === 'solana') return 'about $0.01';
    if (cat === 'tron') return 'about $1';
    if (cat === 'bitcoin' || cat === 'bittensor') return 'about $0.50';
    return '$0.05 to $0.50';
  }
  function actionTextFor(proto, stake, chainName) {
    var cat = (proto.category || '').toLowerCase();
    var protoName = proto.name;
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return 'Supply $' + stake + ' of USDC to ' + protoName + ' on ' + chainName + ' and keep the position open, so the borrow side can use it.';
    if (cat.indexOf('risk curator') >= 0 || cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0 || cat.indexOf('onchain capital') >= 0) return 'Deposit $' + stake + ' into a ' + protoName + ' vault on ' + chainName + ' and keep the shares so the vault\u2019s activity is yours.';
    if (cat.indexOf('dex') >= 0 || cat.indexOf('leveraged farm') >= 0) return 'Provide $' + stake + ' of liquidity to ' + protoName + '\u2019s main pool on ' + chainName + ' and keep the position open through the next fee cycle.';
    if (cat.indexOf('yield aggregator') >= 0 || cat.indexOf('yield') >= 0) return 'Deposit $' + stake + ' into ' + protoName + '\u2019s highest-TVL vault on ' + chainName + ' and let the yield compound.';
    if (cat.indexOf('rwa') >= 0) return 'Mint $' + stake + ' of the protocol\u2019s yield-bearing asset on ' + chainName + ' through ' + protoName + ' and hold it.';
    if (cat.indexOf('basis') >= 0) return 'Deposit $' + stake + ' into a ' + protoName + ' basis vault on ' + chainName + ' and keep the position through one funding cycle.';
    if (cat.indexOf('derivative') >= 0 || cat.indexOf('perpetual') >= 0) return 'Deposit $' + stake + ' of USDC as margin on ' + protoName + ' and open one small hedge, then hold it.';
    if (cat.indexOf('prediction') >= 0) return 'Fund $' + stake + ' and place one market position on ' + protoName + ', then hold it to settlement.';
    if (cat.indexOf('stable') >= 0 || cat.indexOf('wrapper') >= 0) return 'Mint or deposit $' + stake + ' of the stable asset through ' + protoName + ' on ' + chainName + ' and hold it.';
    if (cat.indexOf('insurance') >= 0) return 'Buy $' + stake + ' of cover from ' + protoName + ' on ' + chainName + ' and keep the policy active.';
    if (cat.indexOf('payment') >= 0) return 'Move $' + stake + ' through ' + protoName + ' on ' + chainName + ' and keep a balance in its app.';
    if (cat.indexOf('chain') >= 0) return 'Bridge $' + stake + ' onto the chain ' + protoName + ' secures and use one of its apps.';
    if (cat.indexOf('governance') >= 0) return 'Deposit $' + stake + ' into ' + protoName + ' on ' + chainName + ' and vote on its next proposal.';
    if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) return 'Stake $' + stake + ' of the chain\u2019s staking asset through ' + protoName + ' and keep the receipt.';
    if (cat.indexOf('bridge') >= 0) return 'Bridge $' + stake + ' of USDC to ' + chainName + ' through ' + protoName + ' and use the bridged funds in its app.';
    return 'Deposit $' + stake + ' of USDC into ' + protoName + ' on ' + chainName + ' and keep the position open.';
  }
  function weeklyTextFor(proto) {
    var cat = (proto.category || '').toLowerCase();
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return 'a deposit, a borrow or a repayment';
    if (cat.indexOf('dex') >= 0 || cat.indexOf('leveraged farm') >= 0) return 'a swap or a liquidity top-up';
    if (cat.indexOf('risk curator') >= 0 || cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0 || cat.indexOf('onchain capital') >= 0 || cat.indexOf('yield') >= 0) return 'a deposit, a rebalance or a vote';
    if (cat.indexOf('derivative') >= 0 || cat.indexOf('perpetual') >= 0) return 'a trade or a margin top-up';
    if (cat.indexOf('prediction') >= 0) return 'a market position or a settlement check';
    if (cat.indexOf('stable') >= 0 || cat.indexOf('rwa') >= 0 || cat.indexOf('basis') >= 0) return 'a mint, a redeem or a claim';
    return 'a deposit, a swap or a vote';
  }
  function stepLine(step) {
    var line = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (line.length > 600) line = line.slice(0, 596) + '...';
    if (line.length < 20) line = line + " Hold the position and check the protocol's own page.";
    return line;
  }
  function farmPlan(proto) {
    var chainName = firstChain(proto);
    var stake = stakeFor(proto);
    var hold = holdFor(proto.age_days);
    var gasCost = gasCostFor(chainName);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gasCost + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionTextFor(proto, stake, chainName), cost: '$' + stake + ' of capital and about ' + gasCost + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week on ' + chainName + ', such as ' + weeklyTextFor(proto) + '.', cost: 'about ' + gasCost + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + stake + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepLine);
  }

  function readLocationHash() {
    var fragment = window.location.hash.replace(/^#/, '');
    if (!fragment) return;
    var hashParams = new URLSearchParams(fragment);
    if (hashParams.get('q')) view.q = hashParams.get('q');
    if (hashParams.get('p')) view.selected = hashParams.get('p');
    if (hashParams.get('category')) view.category = hashParams.get('category');
    if (hashParams.get('chain')) view.chain = hashParams.get('chain');
    if (hashParams.get('minTvl')) view.minTvl = Number(hashParams.get('minTvl')) || 0;
    if (hashParams.get('watchlist') === '1') view.watchlistOnly = true;
    if (hashParams.get('tab')) view.tab = hashParams.get('tab');
  }
  function writeLocationHash() {
    var hashParams = new URLSearchParams();
    if (view.q) hashParams.set('q', view.q);
    if (view.category !== 'all') hashParams.set('category', view.category);
    if (view.chain !== 'all') hashParams.set('chain', view.chain);
    if (view.minTvl > 0) hashParams.set('minTvl', String(view.minTvl));
    if (view.watchlistOnly) hashParams.set('watchlist', '1');
    if (view.tab !== 'pre-token') hashParams.set('tab', view.tab);
    if (view.selected) hashParams.set('p', view.selected);
    var nextHash = hashParams.toString();
    if (nextHash) window.history.replaceState(null, '', '#' + nextHash);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var query = view.q.trim().toLowerCase();
    return RADAR_DATA.rows.filter(function (row) {
      if (view.category !== 'all' && row.category !== view.category) return false;
      if (view.chain !== 'all' && (row.chains || []).indexOf(view.chain) < 0) return false;
      if (view.minTvl > 0 && (row.tvl_usd || 0) < view.minTvl) return false;
      if (view.watchlistOnly && !row.watchlist) return false;
      if (!query) return true;
      var haystack = [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(query) >= 0;
    });
  }
  function sortRows(items) {
    var sortKey = view.sort;
    return items.slice().sort(function (x, y) {
      var aVal, bVal;
      if (sortKey === 'name') { aVal = x.name.toLowerCase(); bVal = y.name.toLowerCase(); }
      else if (sortKey === 'tvl') { aVal = x.tvl_usd; bVal = y.tvl_usd; }
      else if (sortKey === 'growth') { aVal = x.change_7d === null ? -Infinity : x.change_7d; bVal = y.change_7d === null ? -Infinity : y.change_7d; }
      else if (sortKey === 'age') { aVal = x.age_days === null ? Infinity : x.age_days; bVal = y.age_days === null ? Infinity : y.age_days; }
      else if (sortKey === 'multiple') { aVal = x.peer_multiple; bVal = y.peer_multiple; }
      else { aVal = x.implied_value_usd; bVal = y.implied_value_usd; }
      if (aVal < bVal) return -view.dir;
      if (aVal > bVal) return view.dir;
      return x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0;
    });
  }

  function pageHeader() {
    return elem('header', { class: 'top' },
      elem('div', { class: 'brand' }, elem('span', { class: 'mark' }), elem('span', { class: 'brand-name', text: 'Token Radar' })),
      elem('div', { class: 'top-meta' },
        elem('span', { text: 'Snapshot ' + RADAR_DATA.as_of }),
        elem('span', { text: 'DefiLlama protocol index' }),
        elem('span', { text: RADAR_DATA.model_version + ' model' })
      )
    );
  }

  function ledeSection() {
    var first = RADAR_DATA.rows[0];
    var middle = RADAR_DATA.rows.length > 0 ? RADAR_DATA.rows[Math.floor(RADAR_DATA.rows.length / 2)].implied_value_usd : 0;
    return elem('section', { class: 'lede' },
      elem('div', null,
        elem('h1', { text: RADAR_DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        elem('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(RADAR_DATA.floor_usd / 1000000) + 'M of TVL and no token on record. The early radar adds ' + RADAR_DATA.early_size + ' pre-token protocols below that floor, every one of them passing the same exclusion rule. Implied value is a model, not a promise.' })
      ),
      elem('div', { class: 'facts' },
        elem('div', { class: 'fact' }, elem('span', { text: 'Watchlist covered' }), elem('b', { text: RADAR_DATA.watchlist_size + ' / ' + RADAR_DATA.watchlist_size })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Pre-token rows scored' }), elem('b', { text: String(RADAR_DATA.board_size) })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Median implied value' }), elem('b', { text: formatUsd(middle) })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Top row' }), elem('b', { text: first ? first.name : 'n/a' })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Live-token protocols set aside' }), elem('b', { text: String(RADAR_DATA.live_size) }))
      )
    );
  }

  function controlPanel() {
    var categoryList = Array.from(new Set(RADAR_DATA.rows.map(function (row) { return row.category || 'Other'; }))).sort();
    var chainList = Array.from(new Set(RADAR_DATA.rows.reduce(function (acc, row) { return acc.concat(row.chains || []); }, []))).sort();
    var searchBox = elem('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: view.q, 'aria-label': 'Search the board' });
    searchBox.addEventListener('input', function () { view.q = searchBox.value; writeLocationHash(); renderBoard(); });
    var categorySelect = elem('select', { id: 'category', 'aria-label': 'Filter by category' },
      elem('option', { value: 'all', text: 'All categories' }),
      categoryList.map(function (cat) { return elem('option', { value: cat, text: cat, selected: cat === view.category ? 'selected' : null }); })
    );
    categorySelect.addEventListener('change', function () { view.category = categorySelect.value; writeLocationHash(); renderBoard(); });
    var chainSelect = elem('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      elem('option', { value: 'all', text: 'All chains' }),
      chainList.map(function (cat) { return elem('option', { value: cat, text: cat, selected: cat === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; writeLocationHash(); renderBoard(); });
    var tvlChoices = [['0', 'Any TVL'], ['50000000', '$50M+'], ['100000000', '$100M+'], ['500000000', '$500M+'], ['1000000000', '$1B+']];
    var tvlSelect = elem('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      tvlChoices.map(function (choice) { return elem('option', { value: choice[0], text: choice[1], selected: Number(choice[0]) === view.minTvl ? 'selected' : null }); })
    );
    tvlSelect.addEventListener('change', function () { view.minTvl = Number(tvlSelect.value) || 0; writeLocationHash(); renderBoard(); });
    var watchlistBox = elem('input', { type: 'checkbox', id: 'watchlist', checked: view.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchlistBox.addEventListener('change', function () { view.watchlistOnly = watchlistBox.checked; writeLocationHash(); renderBoard(); });
    var preTab = elem('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { view.tab = 'pre-token'; renderBoard(); } });
    var liveTab = elem('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { view.tab = 'live'; renderBoard(); } });
    var methodTab = elem('button', { type: 'button', 'aria-pressed': view.tab === 'method' ? 'true' : 'false', text: 'Method', onclick: function () { view.tab = 'method'; renderBoard(); } });
    return elem('div', { class: 'controls' },
      elem('div', { class: 'field' }, elem('label', { for: 'q', text: 'Search' }), searchBox),
      elem('div', { class: 'field' }, elem('label', { for: 'category', text: 'Category' }), categorySelect),
      elem('div', { class: 'field' }, elem('label', { for: 'chain', text: 'Chain' }), chainSelect),
      elem('div', { class: 'field' }, elem('label', { for: 'minTvl', text: 'Minimum TVL' }), tvlSelect),
      elem('label', { class: 'check', for: 'watchlist' }, watchlistBox, 'Watchlist only'),
      elem('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.minTvl = 0; view.watchlistOnly = false; writeLocationHash(); renderBoard(); } }),
      elem('div', { class: 'field' }, elem('span', { class: 'sub', text: 'View' }), elem('div', { class: 'tabs' }, preTab, liveTab, methodTab)),
      elem('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : view.tab === 'live' ? RADAR_DATA.live.length + ' live-token protocols' : 'How every row is scored' })
    );
  }

  function sortableHeader(sortKey, label) {
    return elem('th', { scope: 'col' },
      elem('button', { type: 'button', onclick: function () { if (view.sort === sortKey) view.dir = -view.dir; else { view.sort = sortKey; view.dir = -1; } renderBoard(); } },
        label,
        view.sort === sortKey ? elem('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardPanel() {
    var visible = sortRows(visibleRows());
    if (visible.length === 0) {
      return elem('div', { class: 'panel' }, elem('div', { class: 'empty' },
        elem('h2', { text: 'No protocol matches that filter' }),
        elem('p', { text: 'Clear the search or pick another category to see the board again.' }),
        elem('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.minTvl = 0; view.watchlistOnly = false; writeLocationHash(); renderBoard(); } })
      ));
    }
    var topValue = visible[0].implied_value_usd || 1;
    var tableBody = elem('tbody');
    visible.forEach(function (row) {
      var weekly = row.change_7d === null ? 'n/a' : formatPct(row.change_7d);
      var weeklyClass = row.change_7d === null ? '' : row.change_7d >= 0 ? 'pos' : 'neg';
      var rowEl = elem('tr', {
        'data-selected': view.selected === row.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(row.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(row.slug); } }
      },
        elem('td', { class: 'num', text: String(row.rank) }),
        elem('td', null, elem('div', { class: 'name' },
          elem('b', { text: row.name }),
          elem('span', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        elem('td', { class: 'num', text: formatUsd(row.tvl_usd) }),
        elem('td', { class: 'num ' + weeklyClass, text: weekly }),
        elem('td', { class: 'num', text: formatAge(row.age_days) }),
        elem('td', { class: 'num', text: formatMult(row.peer_multiple) }),
        elem('td', null, elem('div', { class: 'implied' },
          elem('div', { class: 'bar', 'aria-hidden': 'true' }, elem('i', { style: 'width:' + Math.max(3, Math.round((row.implied_value_usd / topValue) * 100)) + '%' })),
          elem('span', { class: 'num', text: formatUsd(row.implied_value_usd) })
        )),
        elem('td', null, elem('span', { class: row.watchlist ? 'badge watch' : 'badge', text: row.watchlist ? 'watchlist' : 'no token' }))
      );
      tableBody.appendChild(rowEl);
    });
    return elem('div', { class: 'panel' },
      elem('div', { class: 'table-wrap' },
        elem('table', null,
          elem('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. Watchlist rows carry the amber mark.' }),
          elem('thead', null, elem('tr', null,
            sortableHeader('implied', 'Rank'),
            sortableHeader('name', 'Protocol'),
            sortableHeader('tvl', 'TVL'),
            sortableHeader('growth', '7d'),
            sortableHeader('age', 'Age'),
            sortableHeader('multiple', 'Multiple'),
            sortableHeader('implied', 'Implied value'),
            elem('th', { scope: 'col', text: 'Token' })
          )),
          tableBody
        )
      )
    );
  }

  function livePanel() {
    var tableBody = elem('tbody');
    RADAR_DATA.live.forEach(function (row) {
      tableBody.appendChild(elem('tr', null,
        elem('td', { class: 'num', text: 'live' }),
        elem('td', null, elem('div', { class: 'name' }, elem('b', { text: row.name }), elem('span', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        elem('td', { class: 'num', text: formatUsd(row.tvl_usd) }),
        elem('td', { class: 'num ' + (row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg'), text: formatPct(row.change_7d) }),
        elem('td', { class: 'num', text: formatUsd(row.mcap_usd) }),
        elem('td', null, elem('span', { class: 'badge', text: 'already trades' }))
      ));
    });
    return elem('div', { class: 'panel' },
      elem('div', { class: 'table-wrap' },
        elem('table', null,
          elem('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap/TVL ratios are what price the board.' }),
          elem('thead', null, elem('tr', null, elem('th', { scope: 'col', text: 'Status' }), elem('th', { scope: 'col', text: 'Protocol' }), elem('th', { scope: 'col', text: 'TVL' }), elem('th', { scope: 'col', text: '7d' }), elem('th', { scope: 'col', text: 'Market cap' }), elem('th', { scope: 'col', text: 'Token' }))),
          tableBody
        )
      )
    );
  }

  function methodPanel() {
    var constants = RADAR_DATA.model;
    var peerTableRows = (RADAR_DATA.peers || []).map(function (peer) {
      return elem('tr', null,
        elem('td', { text: peer.category }),
        elem('td', { class: 'num', text: formatMult(peer.multiple) }),
        elem('td', { class: 'num', text: String(peer.peers) })
      );
    });
    return elem('section', { class: 'panel model' },
      elem('h2', { text: 'How implied value is computed' }),
      elem('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      elem('div', { class: 'formula' },
        'implied = round( tvl_usd x peer(category) x (1 + clamp(change_7d, ' + constants.growth_floor + ', ' + constants.growth_cap + ') / 100 x ' + constants.growth_weight + ') x maturity(age) x (1 + 0.02 x min(chains - 1, 10)) )'
      ),
      elem('p', { class: 'sub', text: 'peer(category) is the median market-cap-to-TVL ratio of the live protocols in that category, ratios winsorized to 0.01–5.00 so one dead token or one outlier cannot move a category, blended with the global median where a category has fewer than five live peers, and clamped to 0.05–0.80. maturity(age) runs 0.70 for a protocol listed yesterday to 1.00 after three years with no token; an unlisted age uses 0.85. TVL, seven-day growth and age come from the snapshot; the chain count widens the multiple by 2% a chain. The board separates the pre-token protocols from the live ones: live-token protocols never enter the ranking, and their market caps are the comparables that price it.' }),
      elem('h3', { text: 'Peer multiples by category' }),
      elem('div', { class: 'table-wrap' },
        elem('table', { class: 'peers' },
          elem('thead', null, elem('tr', null, elem('th', { scope: 'col', text: 'Category' }), elem('th', { scope: 'col', class: 'num', text: 'Peer multiple' }), elem('th', { scope: 'col', class: 'num', text: 'Live peers' }))),
          elem('tbody', null, peerTableRows)
        )
      ),
      elem('p', { class: 'sub', text: 'Left out of the board on purpose: protocols that record a token, exchanges, bridges, liquid-staking and restaking products, versioned pool names, and names carrying wrapped, staked or staking or beginning with an exchange\u2019s name. A protocol "records no token" when DefiLlama\u2019s record lists none — that is not proof it has none.' })
    );
  }

  var detailDialog = elem('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailDialog.addEventListener('close', function () { view.selected = null; writeLocationHash(); });

  function showDetail(slug) {
    var row = RADAR_DATA.rows.filter(function (item) { return item.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeLocationHash();
    detailDialog.textContent = '';
    var plan = farmPlan(row);
    var recomputed = impliedValueOf(row);
    detailDialog.appendChild(elem('div', { class: 'detail-head' },
      elem('div', null,
        elem('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + RADAR_DATA.board_size + (row.watchlist ? ' · watchlist' : ' · early') }),
        elem('h2', { id: 'detail-title', text: row.name }),
        elem('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      elem('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { detailDialog.close(); } })
    ));
    detailDialog.appendChild(elem('section', { class: 'detail-section' },
      elem('h3', { text: 'Implied value' }),
      elem('div', { class: 'equation' },
        elem('div', null, elem('span', { text: 'TVL' }), elem('b', { class: 'num', text: formatUsd(row.tvl_usd) })),
        elem('div', null, elem('span', { text: 'Peer multiple (' + (row.category || 'Other') + ', ' + row.peer_count + ' live peers)' }), elem('b', { class: 'num', text: formatMult(row.peer_multiple) })),
        elem('div', null, elem('span', { text: 'Seven-day growth' }), elem('b', { class: 'num', text: formatPct(row.change_7d) })),
        elem('div', null, elem('span', { text: 'Growth multiplier' }), elem('b', { class: 'num', text: formatMult(row.growth_multiplier) })),
        elem('div', null, elem('span', { text: 'Age with no token' }), elem('b', { class: 'num', text: formatAge(row.age_days) })),
        elem('div', null, elem('span', { text: 'Maturity multiplier' }), elem('b', { class: 'num', text: formatMult(row.maturity_multiplier) })),
        elem('div', null, elem('span', { text: 'Chain multiplier (' + (row.chains ? row.chains.length : 0) + ' chains)' }), elem('b', { class: 'num', text: formatMult(row.chain_multiplier) })),
        elem('div', null, elem('span', { text: 'Implied value' }), elem('b', { class: 'num', text: formatUsd(row.implied_value_usd) }))
      ),
      elem('p', { class: 'sub', text: 'Model ' + RADAR_DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + formatUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. The protocol records no token in the snapshot; that is not proof it has none.' })
    ));
    detailDialog.appendChild(elem('section', { class: 'detail-section' },
      elem('h3', { text: 'Farm plan' }),
      elem('ol', { class: 'steps' }, plan.map(function (step) {
        var cut = step.indexOf(' Cost: ');
        var stepAction = cut >= 0 ? step.slice(0, cut) : step;
        var stepTail = cut >= 0 ? step.slice(cut + 1) : '';
        return elem('li', null, elem('b', { text: stepAction }), elem('span', { class: 'cost', text: stepTail }));
      }))
    ));
    if (typeof detailDialog.showModal === 'function') {
      if (!detailDialog.open) detailDialog.showModal();
    } else {
      detailDialog.setAttribute('open', '');
    }
  }

  function renderBoard() {
    boardEl.textContent = '';
    var page = elem('div', { class: 'shell' });
    page.appendChild(pageHeader());
    page.appendChild(ledeSection());
    page.appendChild(controlPanel());
    if (view.tab === 'live') page.appendChild(livePanel());
    else if (view.tab === 'method') page.appendChild(methodPanel());
    else {
      page.appendChild(boardPanel());
      page.appendChild(methodPanel());
    }
    boardEl.appendChild(page);
    boardEl.setAttribute('aria-busy', 'false');
    if (!detailDialog.isConnected) boardEl.appendChild(detailDialog);
    if (view.selected) showDetail(view.selected);
  }

  readLocationHash();
  renderBoard();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && detailDialog.open) detailDialog.close();
  });
})();
