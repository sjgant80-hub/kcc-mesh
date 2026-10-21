# kcc-mesh

**▶ Live: https://sjgant80-hub.github.io/kcc-mesh/**

> ## ⚠ Two rails — and this repo is ONLY the compute rail.
> These are **internal contribution-units**, **NOT money** — not a currency, not a cryptocurrency, not
> tradeable. **There is no code path from a unit to money:** this kernel exposes **no** `fiat` / `trade` /
> `exchange` / `withdraw` / `sell` / `convert` / `cashout` verb (a test checks that against the code, like
> airgap's no-network invariant). The **money rail** — KCC as a tradeable currency, a fiat on-ramp, an
> exchange listing — is a **separate, gated matter behind legal counsel** (securities and money-transmission
> law apply). It is **not built here** and must not be, without counsel. Money and legal stay human.

The **compute-economy rail**: idle rigs stop mining wasted hashes and become **sovereign mesh-nodes** that
earn internal contribution-units by **verified work** — a bounty is escrowed, a node claims it and does the
compute, and it is paid **only if the result re-verifies** (proof-of-contribution, not proof-of-asking).
Units are **conserved** (no minting after genesis) on a tamper-evident audit chain, and each node has a
**budget ceiling it cannot cross**, so no node can drain the mesh.

## The law (`kernel.mjs`)

- `genesis({ total, holder })` — the one and only unit creation; after this the total never changes.
- `onboard(ledger, { id, budgetCeiling })` — **fork = wallet**: a rig registers as a sovereign node with zero balance and a budget ceiling.
- `postBounty(ledger, { bountyId, poster, amount })` — escrow from the poster. **Red lines:** no minting (cannot escrow more than held); no draining (cannot commit past the budget ceiling); no duplicate bounty.
- `settle(ledger, { bountyId, nodeId, reVerified })` — pay the node **only if `reVerified`**; otherwise the bounty returns to the poster and the node earns nothing. **Red line:** no double-settle.
- `conserved(ledger)` — the load-bearing invariant: balances + open escrow always sum to the genesis total.
- `verifyChain(ledger)` — the audit trail: any tampered or reordered entry breaks the chain.

Pure and total: the kernel never throws on garbage; it returns `{ ok: false, why }`.

## The contribution ledger (`contrib.mjs`)

Every release recorded **now** as a signed contribution: a DIGI card, an app, a node or a mint. Internal contribution units,
**not money**; the same wall as the compute rail (no money-out verb; a test checks the exported surface).

- `record(ledger, entry, { gate })` adds one signed entry to an append-only, hash-chained ledger:
  - **genesis** names the activators and measurers, and seals the allocation policy before any record it weighs;
  - **release** is signed by its maker, and the first release of an asset wins;
  - **give** is signed by the owner of the moment, so a give from a former owner is a double sale and is refused;
  - **value** is a measured contribution (a card's leave-one-out mesh share, an app's usage, a node's routing share),
    signed by a named measurer;
  - **switch** is signed by an activator.
  A release or a value counts only once its **gate** re-runs its proofs.
- `replay(log, { gate })` re-records the whole ledger from nothing and demands the same chain back.
- `credits(ledger)`: each value goes to its asset's owner of that moment, less the maker's part and the parents' part,
  early entries weighted, all as sealed at genesis. The sums are exact.
- `allocate(ledger, { sandbox, pool })` gives each contributor's part of a pool in whole units, summing to the pool exactly.
  **The switch is off**: a live allocation is refused unless the ledger holds a switch entry signed by an activator, and
  the kernel has no verb that writes one. A sandbox allocation is open to anyone.
- `shareOf(ledger, key, …)` returns one contributor's part and every line behind it.
- `reconcile(into, from, { gate })` merges a ledger of the same schema. Entries are identified by the hash of their signed
  content and counted once; conflicts are refused and named.

`ledger/digi.json` records the **DIGI drop**: its 1,000 genesis cards as releases, and organ 6's measured mesh shares as
values. Every entry is gated against the DIGI repository's own records (`digi-gate.mjs`). It regenerates byte for byte:
`node tools/seed-digi.mjs --check`. The page replays it in your browser against the live drop.

Whether an allocation is ever worth anything, and when the switch is turned on, is the ledger owner's decision, with legal
counsel. It is not this code's.

## Composes the estate

- [agora](https://github.com/sjgant80-hub/agora) — escrow + settle-on-re-verify + conservation + hash-chain (proven live).
- [the-wallet](https://github.com/sjgant80-hub/the-wallet) — each node's identity + budget ceiling.
- [mesh-self](https://github.com/sjgant80-hub/mesh-self) — a node is a sovereign sub that cannot drain the mesh.
- fork = wallet onboarding — the id **is** the wallet.

## Honest scope

This is the compute-rail **mechanic**, on an in-browser ledger — **not a live deployed economy**. Running real
rigs, deploying a settlement ledger, and onboarding real hardware are the **operator's hands**, not this
artifact. A **governance layer** for democratic rule-updates (sididy's advice) is the named next fold. The
money rail stays gated. sididy advised on and ratified the red lines.

## Proof of play

- **Mutation-gated CLEAN 27/27** — `node tools/witness.mjs mutate kernel.mjs --timeout 30000 --cap 500 --test node --test kernel.test.mjs`
- **The live page IS the gated kernel** — `make-page.mjs` injects `kernel.mjs` verbatim; CI regenerates and `git diff --exit-code`s.
- Run the tests: `node --test kernel.test.mjs`

MIT.
