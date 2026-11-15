// Token Radar dashboard: renders window.RADAR (written beside this page by main.ts) with no network,
// no framework and no fetch. Board, detail view and filters all run on the same rows board.json holds.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const money = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const moneyShort = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
};
const pct = (n) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const pctClass = (n) => (n === null || n === undefined || n === 0 ? 'flat' : n > 0 ? 'up' : 'down');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ageText = (d) => (d === null || d === undefined ? 'unrecorded' : d >= 730 ? (d / 365).toFixed(1) + ' yrs' : d + ' days');

const state = { q: '', cat: '', chain: '', wl: false, early: false, sort: 'implied', live: false, selected: null };

// ---- Header and method -------------------------------------------------------------
$('chips').innerHTML = [
  `<span class="chip"><b>${R.universe_size}</b>&nbsp;protocols scanned</span>`,
  `<span class="chip"><b class="a">${R.watchlist_size}</b>&nbsp;on the watchlist</span>`,
  `<span class="chip"><b class="g">${R.board_size}</b>&nbsp;ranked pre-token</span>`,
  `<span class="chip"><b>${R.early_size}</b>&nbsp;early finds below the ${moneyShort(R.floor_usd)} floor</span>`,
  `<span class="chip"><b>${R.live_size}</b>&nbsp;already live, set aside</span>`,
  `<span class="chip">market multiple&nbsp;<b>${R.market_multiple.toFixed(4)}&times;</b>&nbsp;from ${R.market_peers} traded peers</span>`,
].join('');
$('src').textContent = `Snapshot as of ${R.as_of} · ${R.source} · every figure on this page is computed from that one sealed file`;
$('modeltag').textContent = 'model ' + R.model_version;

// ---- Filter option lists ------------------------------------------------------------
{
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

// ---- Board rendering ------------------------------------------------------------------
function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.wl && !r.on_watchlist) return false;
    if (state.early && r.on_watchlist) return false;
    return true;
  });
  const by = {
    implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    name: (a, b) => (a.name < b.name ? -1 : 1),
  }[state.sort];
  return rows.sort(by);
}

function renderBoard() {
  const rows = visibleRows();
  $('count').textContent = rows.length + ' of ' + R.board_size + ' rows';
  $('empty').hidden = rows.length > 0;
  $('rows').innerHTML = rows
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}"${state.selected === r.slug ? ' class="sel"' : ''}>
      <td class="num rank">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.on_watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">EARLY</span>'}<span class="slug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.category ?? '—')}</td>
      <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''}</td>
      <td class="num">${moneyShort(r.tvl_usd)}</td>
      <td class="num ${pctClass(r.change_7d)}">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num">${r.model.multiple.toFixed(3)}&times;</td>
      <td class="num val">${money(r.implied_value_usd)}</td></tr>`,
    )
    .join('');
}

function renderLive() {
  $('liverows').innerHTML = R.live
    .map(
      (r) => `<tr>
      <td><span class="pname">${esc(r.name)}</span><span class="slug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.symbol ?? '—')}</td>
      <td class="cat">${esc(r.category ?? '—')}</td>
      <td class="num">${moneyShort(r.tvl_usd)}</td>
      <td class="num">${money(r.mcap_usd)}</td>
      <td class="num">${r.mcap_tvl === null ? '—' : r.mcap_tvl.toFixed(3) + '&times;'}</td>
      <td class="num ${pctClass(r.change_7d)}">${pct(r.change_7d)}</td></tr>`,
    )
    .join('');
}

// ---- Detail view ----------------------------------------------------------------------
function openDetail(slug, scroll) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  state.selected = slug;
  const m = r.model;
  const basis =
    m.multiple_basis === 'category'
      ? `${esc(r.category ?? 'its category')} median across ${m.peers} traded peers`
      : `market-wide median across ${m.peers} traded peers (its category has too few traded peers to price alone)`;
  $('detail').innerHTML = `
    <button class="close" id="dclose">Close</button>
    <div class="d-head">
      <h2>${esc(r.name)} ${r.on_watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">EARLY FIND</span>'}</h2>
      <div class="d-val"><div class="big">${money(r.implied_value_usd)}</div><div class="cap">implied value · rank #${r.rank} of ${R.board_size}</div></div>
    </div>
    <div class="arith">${money(r.tvl_usd)} TVL &times; <b>${m.multiple.toFixed(4)}&times;</b> peer multiple (${basis}) &times; <b>${m.growth_multiplier.toFixed(4)}</b> growth (${pct(m.growth_pct)} in 7 days) &times; <b>${m.maturity_multiplier.toFixed(4)}</b> maturity = <b>${money(r.implied_value_usd)}</b></div>
    <div class="d-grid">
      <div><span>Category</span>${esc(r.category ?? 'none recorded')}</div>
      <div><span>Chains</span>${esc(r.chains.join(', ') || 'none recorded')}</div>
      <div><span>TVL</span>${money(r.tvl_usd)}</div>
      <div><span>7-day TVL change</span>${pct(r.change_7d)}</div>
      <div><span>Tracked since</span>${esc(r.listed_at ?? 'unrecorded')} (${ageText(r.age_days)})</div>
      <div><span>Token status</span>records no token in the snapshot</div>
      <div><span>Model confidence</span>${m.confidence}${m.multiple_basis === 'market' ? ' — priced at the market median' : ''}</div>
      <div><span>Watchlist</span>${r.on_watchlist ? 'yes — at or above the ' + moneyShort(R.floor_usd) + ' floor' : 'no — an early find below the floor'}</div>
    </div>
    <h3>Farm plan — what to do, what it costs, how long it takes</h3>
    <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="note">The plan is generated from ${esc(r.name)}'s category, chains, TVL and age. It does not predict that a token will be issued — it prices what one would be worth on today's record, and keeps a wallet ready if one comes.</p>`;
  $('detail').hidden = false;
  $('dclose').addEventListener('click', () => {
    state.selected = null;
    $('detail').hidden = true;
    renderBoard();
  });
  renderBoard();
  if (scroll) $('detail').scrollIntoView({ block: 'start' });
}

// ---- Controls wiring --------------------------------------------------------------------
function syncFromControls() {
  state.q = $('q').value;
  state.cat = $('cat').value;
  state.chain = $('chain').value;
  state.wl = $('wlonly').checked;
  state.early = $('earlyonly').checked;
  state.sort = $('sort').value;
  renderBoard();
}
for (const id of ['q', 'cat', 'chain', 'wlonly', 'earlyonly', 'sort']) {
  $(id).addEventListener('input', syncFromControls);
  $(id).addEventListener('change', syncFromControls);
}
$('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr) {
    history.replaceState(null, '', '#p=' + tr.dataset.slug);
    openDetail(tr.dataset.slug, true);
  }
});
function setLive(on) {
  state.live = on;
  $('tab-board').classList.toggle('on', !on);
  $('tab-live').classList.toggle('on', on);
  $('board').hidden = on;
  $('livetable').hidden = !on;
  $('count').textContent = on ? R.live_size + ' live protocols (of ' + R.universe_size + ' scanned)' : '';
  if (!on) renderBoard();
}
$('tab-board').addEventListener('click', () => setLive(false));
$('tab-live').addEventListener('click', () => setLive(true));

// ---- Deep links: #p=<slug> opens a detail, #cat=<category> presets the filter, #live=1 the live view
{
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('live') === '1') setLive(true);
  if (h.get('cat')) {
    $('cat').value = h.get('cat');
    state.cat = h.get('cat');
  }
  if (h.get('wl') === '1') {
    $('wlonly').checked = true;
    state.wl = true;
  }
  renderBoard();
  renderLive();
  if (h.get('p')) openDetail(h.get('p'), false);
  else renderBoard();
}
