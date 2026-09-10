import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from './kernel.mjs';
import { genesis, onboard, postBounty, settle, conserved, verifyChain } from './kernel.mjs';

// a small mesh: a genesis holder that seeds bounties, and two onboarded rigs
function seed() {
  let l = genesis({ total: 1000, holder: 'pool' }).ledger;
  l = onboard(l, { id: 'poster', budgetCeiling: 500 }).ledger;
  l = onboard(l, { id: 'rig', budgetCeiling: 500 }).ledger;
  // move some units to the poster so it can post bounties (a genesis transfer, still conserved)
  // (done via a bounty the pool posts and the poster earns, below — but for setup, use a direct pool bounty)
  return l;
}

test('genesis: creates the whole supply once, conserved, chain intact', () => {
  const r = genesis({ total: 1000, holder: 'pool' });
  assert.equal(r.ok, true);
  assert.equal(r.ledger.balances.pool, 1000);
  assert.equal(conserved(r.ledger).conserved, true);
  assert.equal(verifyChain(r.ledger).intact, true);
});

test('genesis: total on garbage, one is the smallest valid supply', () => {
  assert.equal(genesis({ total: 1, holder: 'p' }).ok, true);   // exactly 1 is valid (kills < 1 -> <= 1)
  assert.equal(genesis(null).ok, false);
  assert.equal(genesis({ total: 0, holder: 'p' }).ok, false);
  assert.equal(genesis({ total: 10, holder: '' }).ok, false);
  assert.equal(genesis({ total: 1.5, holder: 'p' }).ok, false);
});

test('onboard: a rig joins with zero balance and a budget ceiling (fork = wallet)', () => {
  const l = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 40 }).ledger;
  assert.equal(l.balances.rig, 0);
  assert.equal(l.ceilings.rig, 40);
  assert.equal(conserved(l).conserved, true);   // onboarding mints nothing
});

test('onboard: refuses a duplicate id and garbage', () => {
  const l = genesis({ total: 100, holder: 'pool' }).ledger;
  assert.equal(onboard(l, { id: 'pool', budgetCeiling: 10 }).ok, false);   // already exists
  assert.equal(onboard(l, { id: 'r1', budgetCeiling: 1 }).ok, true);       // ceiling exactly 1 is valid (kills < 1 -> <= 1)
  assert.equal(onboard(l, { id: 'r', budgetCeiling: 0 }).ok, false);
  assert.equal(onboard(l, { id: '', budgetCeiling: 10 }).ok, false);
});

test('postBounty: escrows from the poster (balance down, spend up, conserved)', () => {
  const l0 = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger;
  const r = postBounty(l0, { bountyId: 'j1', poster: 'pool', amount: 30 });
  assert.equal(r.ok, true);
  assert.equal(r.ledger.balances.pool, 70);
  assert.equal(r.ledger.spent.pool, 30);
  assert.equal(r.ledger.escrow.j1.amount, 30);
  assert.equal(conserved(r.ledger).conserved, true);   // escrow still counts toward the total
});

test('postBounty RED LINE: no minting — cannot escrow more than held', () => {
  const l0 = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger;
  const over = postBounty(l0, { bountyId: 'j1', poster: 'rig', amount: 1 });   // rig holds 0
  assert.equal(over.ok, false);
  assert.ok(over.why.includes('no minting'));
  assert.equal(postBounty(l0, { bountyId: 'j1', poster: 'pool', amount: 100 }).ok, true);  // exactly held is allowed
  assert.equal(postBounty(l0, { bountyId: 'j1', poster: 'pool', amount: 101 }).ok, false); // one over is refused
});

test('postBounty RED LINE: no node drains the mesh — cannot commit past its budget ceiling', () => {
  let l = genesis({ total: 1000, holder: 'pool' }).ledger;
  l = onboard(l, { id: 'poster', budgetCeiling: 50 }).ledger;
  // give the poster 1000 to hold (pool posts, poster earns) — but the ceiling still caps commitment at 50
  l = postBounty(l, { bountyId: 'seedj', poster: 'pool', amount: 100 }).ledger;
  l = settle(l, { bountyId: 'seedj', nodeId: 'poster', reVerified: true }).ledger;   // poster now holds 100
  assert.equal(l.balances.poster, 100);
  assert.equal(postBounty(l, { bountyId: 'a', poster: 'poster', amount: 50 }).ok, true);   // exactly the ceiling
  assert.equal(postBounty(l, { bountyId: 'a', poster: 'poster', amount: 51 }).ok, false);  // one over the ceiling
  assert.ok(postBounty(l, { bountyId: 'a', poster: 'poster', amount: 51 }).why.includes('budget ceiling'));
});

test('postBounty: refuses a duplicate bounty and a non-onboarded poster', () => {
  const l0 = postBounty(onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger, { bountyId: 'j1', poster: 'pool', amount: 10 }).ledger;
  assert.equal(postBounty(l0, { bountyId: 'j1', poster: 'pool', amount: 5 }).ok, false);   // already open
  assert.equal(postBounty(l0, { bountyId: 'j2', poster: 'ghost', amount: 5 }).ok, false);  // not onboarded
  assert.equal(postBounty(l0, { bountyId: 'j3', poster: 'pool', amount: 1 }).ok, true);    // amount 1 is valid
  assert.equal(postBounty(l0, { bountyId: 'j3', poster: 'pool', amount: 0 }).ok, false);   // amount 0 refused (kills the || guard)
});

// ── the earn flow: paid only for re-verified work
test('settle: re-verified work pays the node; conserved', () => {
  let l = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger;
  l = postBounty(l, { bountyId: 'j1', poster: 'pool', amount: 40 }).ledger;
  const r = settle(l, { bountyId: 'j1', nodeId: 'rig', reVerified: true });
  assert.equal(r.ok, true);
  assert.equal(r.paid, 40);
  assert.equal(r.paidTo, 'rig');
  assert.equal(r.ledger.balances.rig, 40);
  assert.equal(r.ledger.balances.pool, 60);
  assert.equal(conserved(r.ledger).conserved, true);
});

test('settle RED LINE: un-re-verified work earns the node NOTHING (returns to the poster)', () => {
  let l = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger;
  l = postBounty(l, { bountyId: 'j1', poster: 'pool', amount: 40 }).ledger;
  const r = settle(l, { bountyId: 'j1', nodeId: 'rig', reVerified: false });
  assert.equal(r.paid, 0);
  assert.equal(r.paidTo, 'pool');           // returned to the poster
  assert.equal(r.ledger.balances.rig, 0);   // the node earned nothing
  assert.equal(r.ledger.balances.pool, 100);
  assert.equal(conserved(r.ledger).conserved, true);
});

test('settle RED LINE: no double-settle', () => {
  let l = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger;
  l = postBounty(l, { bountyId: 'j1', poster: 'pool', amount: 40 }).ledger;
  const first = settle(l, { bountyId: 'j1', nodeId: 'rig', reVerified: true });
  assert.equal(first.ok, true);
  const again = settle(first.ledger, { bountyId: 'j1', nodeId: 'rig', reVerified: true });
  assert.equal(again.ok, false);            // the bounty is closed
  assert.ok(again.why.includes('no open bounty'));
});

test('settle: reVerified must be an explicit boolean; garbage refused', () => {
  let l = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger;
  l = postBounty(l, { bountyId: 'j1', poster: 'pool', amount: 40 }).ledger;
  assert.equal(settle(l, { bountyId: 'j1', nodeId: 'rig' }).ok, false);              // missing reVerified
  assert.equal(settle(l, { bountyId: 'j1', nodeId: 'rig', reVerified: 'yes' }).ok, false);
  assert.equal(settle(l, { bountyId: 'ghost', nodeId: 'rig', reVerified: true }).ok, false);
  assert.equal(settle(l, { bountyId: 'j1', nodeId: 'ghost', reVerified: true }).ok, false);
});

// ── the audit chain
test('verifyChain: intact on a clean ledger, broken by a tamper', () => {
  let l = onboard(genesis({ total: 100, holder: 'pool' }).ledger, { id: 'rig', budgetCeiling: 100 }).ledger;
  l = postBounty(l, { bountyId: 'j1', poster: 'pool', amount: 40 }).ledger;
  assert.equal(verifyChain(l).intact, true);
  // tamper: rewrite an escrow amount without touching the chain -> the entry no longer matches its hash
  const tampered = { ...l, chain: l.chain.map((e, i) => (i === 2 ? { ...e, entry: { ...e.entry, amount: 999 } } : e)) };
  assert.equal(verifyChain(tampered).intact, false);
  assert.equal(verifyChain(tampered).brokeAt, 2);
});

test('verifyChain: the genesis hash is pinned (kills mutated FNV constants)', () => {
  const l = genesis({ total: 1000, holder: 'pool' }).ledger;
  assert.equal(l.chain[0].hash, 'd45bdeda');
});

test('conserved / verifyChain: total on garbage', () => {
  assert.equal(conserved(null).ok, false);
  assert.equal(verifyChain(null).ok, false);
  assert.equal(verifyChain({ chain: [] }).ok, false);
});

// ── the structural wall: no money-out verb exists in the exported surface (like airgap's no-network invariant)
test('THE WALL: the kernel exposes no money-out verb — internal units only, no code path to money', () => {
  const MONEY = /(fiat|exchange|withdraw|cashout|sell|convert|trade|redeem|payout|deposit|usd|gbp|stripe|coinbase)/i;
  const names = Object.keys(K);
  const offenders = names.filter((n) => MONEY.test(n));
  assert.deepEqual(offenders, [], 'a money-out verb reached the exported surface: ' + offenders.join(', '));
  // the exports are exactly the compute-rail verbs
  assert.deepEqual(names.sort(), ['conserved', 'genesis', 'onboard', 'postBounty', 'settle', 'verifyChain']);
});
