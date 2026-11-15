// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// THE VALUE MODEL (radar-2). No revenue or user figures exist in the snapshot, so the model prices a
// pre-token protocol the way the snapshot's own market prices its tokenized peers:
//
//   peers(category) = the token-bearing protocols in the same category that carry both a market cap
//                     and a TVL; each peer's ratio is mcap_usd / tvl_usd.
//   multiple        = the category's median peer ratio when the category has at least PEER_MIN peers,
//                     else the market-wide median peer ratio. Either way it is clamped to
//                     [MULTIPLE_FLOOR, MULTIPLE_CAP] so one thin or frothy category cannot dominate.
//   growthMult      = 1 + clamp(change_7d, -60, +120) / 100 x GROWTH_WEIGHT   (momentum, one week)
//   maturityMult    = 0.6 + 0.4 x min(age_days, 1095) / 1095                  (track record)
//   implied         = round(tvl_usd x multiple x growthMult x maturityMult)
//
// Every input is a figure the snapshot itself carries: TVL, the seven-day change, the listing date and
// the market caps of protocols whose token already trades. No protocol name is special-cased anywhere:
// the same function prices every row, and each row carries its own arithmetic so a reader can check it.
//
// THE BOARD. Every watchlist slug is ranked (the floor, never the ceiling), plus every other protocol
// that records no token and is not a product of a token that already trades: exchange products, bridge
// and canonical-bridge categories, liquid staking / restaking categories, versioned pools (a name
// ending in V2, 2.0 and the like), and names carrying the whole word wrapped, staked or staking or
// opening with an exchange's name are set aside, for the same reason the watchlist rule sets them
// aside. Protocols whose token already trades are never ranked: they are listed apart at their real
// market caps, and they are the peer set the multiples are priced from.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the arithmetic by hand. */
export interface ModelConstants {
  peer_min: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  peer_min: 4,
  multiple_floor: 0.02,
  multiple_cap: 2.5,
  growth_weight: 0.5,
  growth_floor_pct: -60,
  growth_cap_pct: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Already live view carries, by market cap. */
export const LIVE_ROWS = 36;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name marks a product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that open with an exchange's name are that exchange's own products. */
const EXCHANGE_FIRST = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Categories that are products of other tokens rather than protocols awaiting a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol is a product of a token that already trades, by the watchlist rule's own tests. */
export function isProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && (PRODUCT_CATEGORIES.has(p.category) || p.category.endsWith(' Bridge'))) return true;
  return VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_FIRST.test(p.name);
}

/** Whether the board may rank a protocol: it records no token and is not a product of one that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProduct(p);
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The peer set the multiples are priced from: category -> the ratios of its token-bearing peers. */
export interface PeerTable {
  /** The market-wide median mcap/TVL ratio across every priced peer. */
  market_multiple: number;
  /** How many peers priced the market-wide median. */
  market_peers: number;
  /** Per-category median ratio and peer count, for categories with at least one priced peer. */
  by_category: Map<string, { multiple: number; peers: number }>;
}

/** Build the peer table from the snapshot's token-bearing protocols (mcap and TVL both present). */
export function peerTable(snapshot: Snapshot): PeerTable {
  const all: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const by_category = new Map<string, { multiple: number; peers: number }>();
  for (const [category, ratios] of byCategory) {
    by_category.set(category, { multiple: median(ratios), peers: ratios.length });
  }
  return { market_multiple: all.length > 0 ? median(all) : 0.2, market_peers: all.length, by_category };
}

/** The multiple one protocol is priced at, and where it came from. */
export interface Priced {
  multiple: number;
  basis: 'category' | 'market';
  peers: number;
}

/** Price one protocol's category: its own median when it has enough peers, else the market's. */
export function priceCategory(category: string | null, peers: PeerTable, model: ModelConstants): Priced {
  const clamp = (m: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
  const own = category === null ? undefined : peers.by_category.get(category);
  if (own !== undefined && own.peers >= model.peer_min) {
    return { multiple: clamp(own.multiple), basis: 'category', peers: own.peers };
  }
  return { multiple: clamp(peers.market_multiple), basis: 'market', peers: peers.market_peers };
}

/** One protocol's full arithmetic under the model: every factor a reader needs to check the row. */
export interface Valuation {
  implied: number;
  multiple: number;
  basis: 'category' | 'market';
  peers: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  confidence: 'high' | 'medium' | 'low';
}

/** Value one pre-token protocol from the snapshot's own figures. */
export function impliedValue(p: SnapshotProtocol, asOf: string, peers: PeerTable, model: ModelConstants): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const priced = priceCategory(p.category, peers, model);
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, finite(p.change_7d, 0)));
  const ageForModel = age ?? model.unknown_age_days;
  // The factors are rounded to 4 places BEFORE the multiplication, so the arithmetic a row prints is
  // the arithmetic that produced it: TVL x multiple x growth x maturity reproduces the implied value.
  const multiple = round4(priced.multiple);
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const maturityMult = round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  const confidence: Valuation['confidence'] =
    priced.basis === 'category' && p.change_7d !== null && age !== null ? 'high' : priced.basis === 'category' || (p.change_7d !== null && age !== null) ? 'medium' : 'low';
  return {
    implied,
    multiple,
    basis: priced.basis,
    peers: priced.peers,
    growth_pct: growthPct,
    growth_multiplier: growthMult,
    maturity_multiplier: maturityMult,
    age_days: age,
    confidence,
  };
}

/** One row of board.json: the ranked board's row, with its arithmetic and its farm plan. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_basis: 'category' | 'market';
    peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    confidence: 'high' | 'medium' | 'low';
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the same figures and the same plan the board carries. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  symbol: string | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard renders: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  market_multiple: number;
  market_peers: number;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A category playbook: the core action, a second action, and the risk that matters most. */
interface Playbook {
  core: (name: string, chain: string, capital: number) => string;
  second: (name: string, chain: string, capital: number) => string;
  risk: string;
}

const PLAYBOOKS: { match: string[]; book: Playbook }[] = [
  {
    match: ['dex'],
    book: {
      core: (n, c, k) => `Provide $${k} of liquidity to ${n}'s deepest stablecoin or ETH pool on ${c} and keep the LP position open.`,
      second: (n, c, k) => `Route about $${Math.max(10, Math.round(k / 5))} of swaps a week through ${n} itself rather than an aggregator, so the volume is credited to your wallet.`,
      risk: 'Impermanent loss is the real cost here: if the pair drifts apart you can withdraw less than you deposited, so prefer correlated pairs while you farm.',
    },
  },
  {
    match: ['uncollateralized lending', 'lending'],
    book: {
      core: (n, c, k) => `Supply $${k} of USDC to ${n} on ${c} and leave the deposit untouched so it counts in every weekly snapshot.`,
      second: (n) => `Borrow about 30% against the deposit once and repay it a week later, so ${n} records both a supplier and a borrower history for the wallet.`,
      risk: 'A borrow against your own deposit can be liquidated if collateral prices gap down; keep the loan small and the health factor above 2 at all times.',
    },
  },
  {
    match: ['cdp'],
    book: {
      core: (n, c, k) => `Deposit $${k} of collateral into a ${n} vault on ${c} and mint its stablecoin against it at a conservative ratio.`,
      second: (n) => `Hold the minted stablecoin in your wallet or supply it back inside ${n}, and vote in any vault-parameter poll the protocol runs.`,
      risk: 'Your vault is liquidated if the collateral falls through its ratio; mint at most half the maximum and check the vault weekly.',
    },
  },
  {
    match: ['risk curators', 'onchain capital allocator', 'curator', 'allocator'],
    book: {
      core: (n, c, k) => `Deposit $${k} of USDC into a ${n} curated vault on ${c} and keep the vault shares in the deposit wallet.`,
      second: (n, c) => `Split a second, smaller deposit across a different ${n} vault on ${c} so your history spans more than one strategy.`,
      risk: 'Curated vaults carry the curator\'s strategy risk: a bad underlying market can lose principal, so read the vault\'s exposure list before depositing.',
    },
  },
  {
    match: ['yield aggregator', 'yield', 'liquidity manager'],
    book: {
      core: (n, c, k) => `Deposit $${k} of USDC into ${n}'s main vault on ${c} and hold the vault shares without moving them.`,
      second: (n) => `Claim and re-deposit any harvested rewards inside ${n} once a month, so compounding transactions build a longer history.`,
      risk: 'Yield vaults stack other protocols\' contracts under yours; a failure in an underlying farm reaches your deposit, so keep the position sized to lose.',
    },
  },
  {
    match: ['derivatives', 'perpetual', 'interest rate derivatives', 'options'],
    book: {
      core: (n, c, k) => `Deposit $${k} of USDC as margin on ${n} and open one small position you are willing to hold for a week.`,
      second: (n, k) => `Trade about $${Math.max(10, Math.round(k / 4))} of volume a week on ${n} in small clips, hedging on another venue if you want no market risk.`,
      risk: 'Margin positions can be liquidated in minutes on a wick; use low or no leverage and never let the farm position become a directional bet.',
    },
  },
  {
    match: ['basis trading'],
    book: {
      core: (n, c, k) => `Deposit $${k} of USDC or staked ETH into ${n} on ${c} and hold the basis position it issues.`,
      second: (n) => `Add a small top-up deposit to ${n} once a month so the wallet shows recurring, not one-off, usage.`,
      risk: 'Basis trades unwind badly when funding flips negative; the position can mark down before it recovers, so do not farm it with funds you need soon.',
    },
  },
  {
    match: ['rwa'],
    book: {
      core: (n, c, k) => `Mint $${k} of ${n}'s yield-bearing asset on ${c} through its own app and hold it in the minting wallet.`,
      second: (n, c) => `Use the asset once inside ${n}'s own ecosystem on ${c} (as collateral or in its pool) so the wallet shows more than a mint.`,
      risk: 'Real-world-asset tokens depend on an off-chain issuer honouring redemptions; treat the position as illiquid until you have tested a small withdrawal.',
    },
  },
  {
    match: ['staking', 'restaking'],
    book: {
      core: (n, c, k) => `Stake $${k} of the chain's staking asset through ${n} on ${c} and keep the receipt token in the staking wallet.`,
      second: (n, c) => `Restake or deposit the receipt once inside ${n}'s own points programme on ${c}, if it runs one, and keep both receipts.`,
      risk: 'Staked positions can be locked or slashed and the receipt can trade below the underlying asset; check the exit terms before you stake.',
    },
  },
  {
    match: ['stablecoin', 'algo-stable'],
    book: {
      core: (n, c, k) => `Mint or deposit $${k} of ${n}'s stable asset on ${c} and hold it rather than swapping straight back out.`,
      second: (n, c) => `Supply the stable asset to ${n}'s own pool or savings module on ${c} so the wallet earns a recorded balance history.`,
      risk: 'A young stablecoin can lose its peg; test a small redemption early and never hold more than you could watch go to zero.',
    },
  },
  {
    match: ['prediction'],
    book: {
      core: (n, c, k) => `Fund $${k} on ${n} and place small positions in three of its most liquid markets.`,
      second: (n) => `Settle every finished market on ${n} promptly, so the wallet's history shows completed, not abandoned, positions.`,
      risk: 'Prediction positions settle to zero or full value; size every position as a total loss and farm with activity, not conviction.',
    },
  },
  {
    match: ['insurance'],
    book: {
      core: (n, c, k) => `Buy $${k} of cover from ${n} on ${c} for a position you actually hold, and keep the policy to expiry.`,
      second: (n, c, k) => `Stake about $${Math.max(10, Math.round(k / 5))} into ${n}'s underwriting pool on ${c} if it offers one, and keep the stake.`,
      risk: 'Underwriting stakes pay out claims from your deposit; a single large claim can cut the stake, so underwrite small.',
    },
  },
  {
    match: ['payments', 'card'],
    book: {
      core: (n, c, k) => `Onboard with ${n}, load $${k}, and make your ordinary card or payment spending run through it.`,
      second: (n) => `Keep a balance on ${n} between spends and complete its identity steps, which most reward programmes require before any payout.`,
      risk: 'Payment products hold your balance as a custodian; keep only spending money loaded, never your savings.',
    },
  },
  {
    match: ['chain'],
    book: {
      core: (n, c, k) => `Bridge $${k} of funds to ${n}'s chain and make it your active chain for a month of ordinary transactions.`,
      second: (n) => `Use two or three of the young chain's own apps weekly, so the wallet reads as an early resident, not a passer-by.`,
      risk: 'A young chain\'s bridge is its weakest contract; bridge in tranches and keep the bulk of funds on established chains.',
    },
  },
  {
    match: ['indexes', 'index'],
    book: {
      core: (n, c, k) => `Mint $${k} of ${n}'s main index token on ${c} and hold it through at least one rebalance.`,
      second: (n) => `Provide liquidity for the index token in ${n}'s named pool, so the wallet also appears as a market maker.`,
      risk: 'An index token is only as sound as its weakest component; read the composition before minting and rebalance dates after.',
    },
  },
  {
    match: ['privacy'],
    book: {
      core: (n, c, k) => `Deposit $${k} into ${n} on ${c} through its own interface and make one private transfer to a second wallet you own.`,
      second: (n) => `Use ${n} for one real payment a month, so the wallet's history is usage, not a single test deposit.`,
      risk: 'Privacy tools attract compliance scrutiny at exchanges; keep records of the funds\' source so you can explain every deposit.',
    },
  },
];

const GENERIC_BOOK: Playbook = {
  core: (n, c, k) => `Deposit $${k} of USDC into ${n} on ${c} through its own app and keep the position open.`,
  second: (n) => `Repeat the core action on ${n} once a month at a smaller size, so the wallet shows a returning user rather than a single visit.`,
  risk: 'Every young protocol carries contract risk; keep the position small enough that a total loss is a tuition fee, not a disaster.',
};

/** The playbook for a protocol's category: the first book whose words appear in the category name. */
function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) {
    if (entry.match.some((m) => c.includes(m))) return entry.book;
  }
  return GENERIC_BOOK;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) by its category's playbook — never from a
 * hand-written list of names. The plan says what to do before a launch and what to do at one.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p);
  const gas = capital >= 250 ? 8 : capital >= 100 ? 5 : 3;
  return [
    stepText(
      `Start from a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline on paper.`,
      'under $3 of gas for its first transaction',
      '5 minutes',
    ),
    stepText(book.core(p.name, chain, capital), `$${capital} of capital plus about $${gas} of gas`, '15 minutes to set up'),
    stepText(book.second(p.name, chain, capital), 'about $2 of gas', '10 minutes'),
    stepText(
      `Make one qualifying action on ${p.name} every week — a deposit, a borrow, a swap, a claim or a vote — so the wallet is active in several snapshots, not one.`,
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days; protocols that reward users reward the ones still there at the snapshot, and this one has run ${age === null ? 'for an unrecorded span' : `about ${age} days`} with no token.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `${book.risk} Check balances weekly and claim only from links on ${p.name}'s own site — never pay a fee to claim an airdrop.`,
      '10 minutes a week, and nothing to claim',
      'weekly',
    ),
    stepText(
      `If ${p.name} issues a token, check eligibility on its official page from the farm wallet first, claim only there, then decide hold or sell with the farm log in front of you: wallet, dates and every transaction, written down as you go.`,
      'claim gas only, about $2',
      '20 minutes at launch, 5 minutes of logging a week until then',
    ),
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age_days,
    implied_value_usd: s.v.implied,
    model: {
      multiple: s.v.multiple,
      multiple_basis: s.v.basis,
      peers: s.v.peers,
      growth_pct: s.v.growth_pct,
      growth_multiplier: s.v.growth_multiplier,
      maturity_multiplier: s.v.maturity_multiplier,
      confidence: s.v.confidence,
    },
    farm_steps: farmSteps(s.p, s.v.age_days),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Already live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    market_multiple: round4(peers.market_multiple),
    market_peers: peers.market_peers,
    universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `the board invents slugs: ${invented.slice(0, 5).map((r) => r.slug).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return `bad slug ${r.slug}`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
