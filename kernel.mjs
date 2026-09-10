// kcc-mesh — the COMPUTE-ECONOMY rail. Idle rigs become sovereign mesh-nodes that earn internal
// contribution-units (KCC) by VERIFIED work: a bounty is escrowed, a node claims and does the compute,
// and it is paid ONLY IF the result re-verifies (proof-of-contribution, not proof-of-asking). Units are
// CONSERVED — there is no minting after genesis, so a node earns only what another committed. Each node
// has a budget ceiling it cannot cross, so no single node can drain the mesh.
//
// ⚑ TWO RAILS, and this file is ONLY the compute rail. The MONEY rail — KCC as a tradeable currency, a
// fiat on-ramp, an exchange listing — is NOT here and is gated behind legal counsel (securities and
// money-transmission law apply). These are INTERNAL contribution-units, NOT money, NOT a cryptocurrency,
// NOT tradeable. The wall is STRUCTURAL, not a promise: this kernel exposes NO money-out verb — no fiat,
// trade, exchange, withdraw, sell, convert, or cashout — so there is no code path from a unit to money.
// (The test `no money verb in the exported surface` checks this against the code, like airgap's
// no-network invariant.)
//
// Composes the estate: agora (escrow + settle-on-re-verify + hash-chain + conservation), the-wallet
// (each node's identity + budget ceiling), mesh-self (a node is a sovereign sub that cannot drain the
// mesh), fork=wallet (onboarding: the id IS the wallet). Pure and total; guards one-per-line.

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

// a deterministic content hash for the audit chain (FNV-1a; an audit trail, not a security signature —
// real deployment signs each entry with the-wallet's Ed25519).
function fnv(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const link = (prev, entry) => fnv(prev + '|' + JSON.stringify(entry));

function clone(l) {
  return {
    total: l.total,
    balances: { ...l.balances },
    spent: { ...l.spent },
    ceilings: { ...l.ceilings },
    escrow: Object.fromEntries(Object.entries(l.escrow).map(([k, v]) => [k, { ...v }])),
    settled: [...l.settled],
    chain: l.chain.map((e) => ({ entry: e.entry, hash: e.hash })),
  };
}

// append a chain entry whose hash links to the one before it (tamper-evident audit trail)
function append(l, entry) {
  const prev = l.chain.length ? l.chain[l.chain.length - 1].hash : '';
  l.chain.push({ entry, hash: link(prev, entry) });
}

/** genesis({ total, holder }) — the ONE and only unit creation: `total` units, all held by `holder`. After
 * this the total never changes (conservation). Everyone else onboards with zero and earns by work. */
export function genesis(m) {
  if (!isObj(m)) return { ok: false, why: 'reads { total, holder }' };
  if (!isInt(m.total) || m.total < 1) return { ok: false, why: 'total must be a positive integer' };
  if (!isStr(m.holder)) return { ok: false, why: 'holder must be a non-empty id' };
  const l = { total: m.total, balances: { [m.holder]: m.total }, spent: { [m.holder]: 0 }, ceilings: { [m.holder]: m.total }, escrow: {}, settled: [], chain: [] };
  append(l, { type: 'genesis', total: m.total, holder: m.holder });
  return { ok: true, ledger: l };
}

/** onboard(ledger, { id, budgetCeiling }) — fork = wallet: a rig registers as a sovereign node with zero
 * balance and a budget ceiling it cannot cross (its lifetime commitment cap). No minting — it earns by work. */
export function onboard(ledger, m) {
  if (!isObj(ledger)) return { ok: false, why: 'ledger must be an object' };
  if (!isObj(m)) return { ok: false, why: 'reads { id, budgetCeiling }' };
  if (!isStr(m.id)) return { ok: false, why: 'id must be a non-empty string (the fork IS the wallet)' };
  if (m.id in ledger.balances) return { ok: false, why: 'a node with id ' + m.id + ' already exists' };
  if (!isInt(m.budgetCeiling) || m.budgetCeiling < 1) return { ok: false, why: 'budgetCeiling must be a positive integer' };
  const l = clone(ledger);
  l.balances[m.id] = 0;
  l.spent[m.id] = 0;
  l.ceilings[m.id] = m.budgetCeiling;
  append(l, { type: 'onboard', id: m.id, budgetCeiling: m.budgetCeiling });
  return { ok: true, ledger: l };
}

/** postBounty(ledger, { bountyId, poster, amount }) — escrow `amount` from the poster for a job. Refuses
 * an overdraft (no minting: a poster cannot escrow more than it holds) and refuses committing past the
 * poster's budget ceiling (no single node drains the mesh). Refuses a duplicate bounty. */
export function postBounty(ledger, m) {
  if (!isObj(ledger)) return { ok: false, why: 'ledger must be an object' };
  if (!isObj(m)) return { ok: false, why: 'reads { bountyId, poster, amount }' };
  if (!isStr(m.bountyId)) return { ok: false, why: 'bountyId must be a non-empty string' };
  if (m.bountyId in ledger.escrow) return { ok: false, why: 'a bounty with id ' + m.bountyId + ' is already open' };
  if (ledger.settled.includes(m.bountyId)) return { ok: false, why: 'bounty id ' + m.bountyId + ' was already used' };
  if (!isStr(m.poster) || !(m.poster in ledger.balances)) return { ok: false, why: 'poster must be an onboarded node' };
  if (!isInt(m.amount) || m.amount < 1) return { ok: false, why: 'amount must be a positive integer' };
  if (m.amount > ledger.balances[m.poster]) return { ok: false, why: 'no minting — a poster cannot escrow more than it holds' };
  if (ledger.spent[m.poster] + m.amount > ledger.ceilings[m.poster]) return { ok: false, why: 'the poster would cross its budget ceiling — no node drains the mesh' };
  const l = clone(ledger);
  l.balances[m.poster] -= m.amount;
  l.spent[m.poster] += m.amount;
  l.escrow[m.bountyId] = { amount: m.amount, poster: m.poster };
  append(l, { type: 'postBounty', bountyId: m.bountyId, poster: m.poster, amount: m.amount });
  return { ok: true, ledger: l };
}

/** settle(ledger, { bountyId, nodeId, reVerified }) — pay the node the escrowed bounty ONLY IF the work
 * re-verified (proof-of-contribution). If it did not, the bounty returns to the poster — the node earns
 * NOTHING for un-re-verified work. Refuses a double-settle and an unknown bounty. Units are conserved. */
export function settle(ledger, m) {
  if (!isObj(ledger)) return { ok: false, why: 'ledger must be an object' };
  if (!isObj(m)) return { ok: false, why: 'reads { bountyId, nodeId, reVerified }' };
  if (!isStr(m.bountyId)) return { ok: false, why: 'bountyId must be a non-empty string' };
  if (!(m.bountyId in ledger.escrow)) return { ok: false, why: 'no open bounty with id ' + m.bountyId };
  if (typeof m.reVerified !== 'boolean') return { ok: false, why: 'reVerified must be a boolean — the mesh must have re-verified the result' };
  if (!isStr(m.nodeId) || !(m.nodeId in ledger.balances)) return { ok: false, why: 'nodeId must be an onboarded node' };
  const { amount, poster } = ledger.escrow[m.bountyId];
  const l = clone(ledger);
  const paidTo = m.reVerified ? m.nodeId : poster;   // proven work pays the node; unproven returns to the poster
  l.balances[paidTo] += amount;
  delete l.escrow[m.bountyId];
  l.settled.push(m.bountyId);
  append(l, { type: 'settle', bountyId: m.bountyId, nodeId: m.nodeId, reVerified: m.reVerified, paidTo });
  return { ok: true, ledger: l, paid: m.reVerified ? amount : 0, paidTo };
}

/** conserved(ledger) — the load-bearing invariant: balances + open escrow always sum to the genesis total.
 * No unit was ever minted or destroyed. */
export function conserved(ledger) {
  if (!isObj(ledger) || !isObj(ledger.balances)) return { ok: false, why: 'ledger must be an object with balances' };
  let sum = 0;
  for (const id of Object.keys(ledger.balances)) sum += ledger.balances[id];
  for (const b of Object.keys(ledger.escrow)) sum += ledger.escrow[b].amount;
  return { ok: true, conserved: sum === ledger.total, sum, total: ledger.total };
}

/** verifyChain(ledger) — the audit trail: re-derive every hash from the one before it; any tampered or
 * reordered entry breaks the chain. */
export function verifyChain(ledger) {
  if (!isObj(ledger) || !Array.isArray(ledger.chain) || ledger.chain.length === 0) return { ok: false, why: 'ledger must carry a non-empty chain' };
  let prev = '';
  for (let i = 0; i < ledger.chain.length; i += 1) {
    const e = ledger.chain[i];
    if (e.hash !== link(prev, e.entry)) return { ok: true, intact: false, brokeAt: i };
    prev = e.hash;
  }
  return { ok: true, intact: true };
}
