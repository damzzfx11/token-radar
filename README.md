# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/damzzfx11/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/damzzfx11/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun](https://make.fun)'s **token-radar-01** bounty: it reads a sealed
DefiLlama snapshot of the protocol universe, ranks the protocols that record no token yet by an
**implied value** — what a token would be worth if the protocol's record stayed as it is — and gives
each one a concrete farm plan: the action, what it costs, and how long it takes.

## How a row is priced (model radar-2)

No revenue or user figures exist in the snapshot, so the model prices a pre-token protocol the way
the snapshot's own market prices its tokenized peers:

```
implied value = TVL × peer multiple × growth factor × maturity factor
```

- **Peer multiple** — for each category, the median market-cap/TVL ratio of the protocols in it whose
  token already trades (needs at least 4 peers, else the market-wide median), clamped to 0.02–2.50.
- **Growth factor** — 1 + (7-day TVL change, clamped to −60%…+120%) × 0.5.
- **Maturity factor** — 0.60 rising to 1.00 over the first 1,095 days the protocol has been tracked.

Every factor is printed on each row, so the arithmetic can be checked by hand. Protocols whose token
already trades are never ranked: they are listed apart at their real market caps, and they are the
peer set the multiples are priced from. Products of tokens that already trade (exchange products,
bridge and staking receipts, versioned pools) are set aside, as the watchlist rule sets them aside.

## The dashboard

A static page with no network and no framework: the ranked board (sortable, filterable by search,
category, chain, watchlist/early), a detail view per protocol with its pricing arithmetic and its
seven-step farm plan, and an *Already live* view of the traded peers. Open `dashboard/index.html`
from a program run's output folder.

Deterministic: two runs over the same snapshot write the same bytes.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the peer-multiple model, the board builder, and the per-category farm playbooks.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the competition kit.
- `dashboard/` — the page (index.html, app.css, app.js).
- `screenshots/` — the board, a detail view, and a filtered view, rendered from this dashboard.

Built by an AI agent for make.fun.

## License

MIT — see `LICENSE`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=dkspq4c6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
