import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './contrib.mjs';
import { canonical, sha256, keysFromPhrase, sign, idOf, empty, record, replay, ownerAt, credits, allocate, shareOf, reconcile, SCHEMA, ZERO, PPM, FORMS, BASES } from './contrib.mjs';

// demo keys from public phrases: anyone can reproduce every signature here
const K = {};
for (const n of ['keeper', 'maker', 'maker2', 'owner', 'friend', 'measurer', 'stranger']) K[n] = await keysFromPhrase('kcc-test/' + n);
const D = (h) => h.repeat(64).slice(0, 64);
const proof = (ref = 'digi-card:card:9f23430f85153414') => [{ kind: 'card', ref, digest: D('a') }];
const POLICY = { makerPpm: 100000, lineagePpm: 50000, earlyUntil: 3, earlyNum: 3, earlyDen: 2 };
const pass = () => ({ ok: true });
const T = '2026-10-21T12:00:00Z';
const s = async (keys, fields) => { const r = await sign(keys, fields); assert.equal(r.ok, true, r.why); return r.entry; };
const genesisOf = (over = {}) => s(K.keeper, { type: 'genesis', activators: [K.keeper.pub], measurers: [K.measurer.pub], policy: POLICY, ...over });
const release = (keys, asset, over = {}) => s(keys, { type: 'release', asset, form: 'card', lineage: [], proofs: proof(), at: T, ...over });
const give = (keys, asset, to, over = {}) => s(keys, { type: 'give', asset, to, at: T, ...over });
const value = (asset, job, units, over = {}) => s(K.measurer, { type: 'value', asset, basis: 'mesh-share', job, units, proofs: proof('digi-card:mesh:' + job), at: T, ...over });
async function chain(entries, opts = { gate: pass }) {
  let l = empty();
  for (const e of entries) { const r = await record(l, e, opts); assert.equal(r.ok, true, r.why); l = r.ledger; }
  return l;
}

test('canonical: sorted keys, no whitespace, whole numbers only, one form', () => {
  assert.equal(canonical({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(canonical({ a: { d: 2, c: 1 } }), '{"a":{"c":1,"d":2}}');
  assert.equal(canonical(1.5), null);
  assert.equal(canonical([1, 2.5]), null);
  assert.equal(canonical({ a: 1.5 }), null);
  assert.equal(canonical({ a: { b: 0.1 } }), null);
  assert.equal(canonical(undefined), null);
  assert.equal(canonical(() => 1), null);
  assert.equal(canonical(false), 'false');
  assert.equal(canonical('é"'), '"é\\""');
  assert.equal(canonical(-7), '-7');
  assert.equal(canonical(2 ** 53), null);
});

test('sha256 and keys from a phrase are reproducible', async () => {
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const again = await keysFromPhrase('kcc-test/maker');
  assert.equal(again.pub, K.maker.pub);
  assert.match(K.maker.pub, /^[0-9a-f]{64}$/);
  assert.notEqual(K.maker.pub, K.owner.pub);
});

test('sign: an entry carries its signer and a 64-byte signature; junk is refused', async () => {
  const r = await sign(K.maker, { type: 'x', n: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.entry.by, K.maker.pub);
  assert.match(r.entry.sig, /^[0-9a-f]{128}$/);
  assert.equal((await sign(null, { a: 1 })).ok, false);
  assert.equal((await sign({ pub: 'zz', priv: K.maker.priv }, { a: 1 })).ok, false);
  assert.equal((await sign({ pub: K.maker.pub }, { a: 1 })).ok, false);
  assert.equal((await sign(K.maker, [1])).ok, false);
  assert.equal((await sign(K.maker, { a: 0.5 })).ok, false);
  assert.match((await sign(K.maker, { a: 0.5 })).why, /whole numbers/);
  assert.equal((await sign({ pub: K.maker.pub, priv: {} }, { a: 1 })).ok, false);
});

test('record: a ledger begins with one genesis, signed, and every link names the one before', async () => {
  const g = await genesisOf();
  const l0 = empty();
  assert.equal(l0.head, ZERO);
  assert.equal(l0.schema, SCHEMA);
  const r = await record(l0, g);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.ledger.log.length, 1);
  assert.equal(r.ledger.log[0].n, 0);
  assert.equal(r.ledger.log[0].prev, ZERO);
  assert.equal(r.ledger.head, await sha256(canonical(r.ledger.log[0])));
  assert.equal(r.id, await idOf(g));
  assert.equal(l0.log.length, 0);   // the ledger handed in is not changed
  assert.match((await record(r.ledger, await genesisOf({ measurers: [] }))).why, /one genesis/);
  assert.match((await record(empty(), await release(K.maker, 'a1'), { gate: pass })).why, /begins with its genesis/);
  assert.match((await record(r.ledger, g)).why, /already recorded \(entry 0\)/);
});

test('record: a forged or altered entry is refused by its signature', async () => {
  const l = await chain([await genesisOf()]);
  const e = await release(K.maker, 'a1');
  assert.match((await record(l, { ...e, asset: 'a2' }, { gate: pass })).why, /signature does not check/);
  assert.match((await record(l, { ...e, by: K.owner.pub }, { gate: pass })).why, /signature does not check/);
  assert.match((await record(l, { ...e, sig: 'ab'.repeat(64) }, { gate: pass })).why, /signature does not check/);
  assert.equal((await record(l, e, { gate: pass })).ok, true);
});

test('record: shapes — every entry has exactly its fields, and each field its form', async () => {
  const l = await chain([await genesisOf()]);
  const bad = async (fields, re, keys = K.maker) => { const r = await record(l, await s(keys, fields), { gate: pass }); assert.equal(r.ok, false); assert.match(r.why, re); };
  assert.match((await record(l, null)).why, /not a contribution entry/);
  assert.match((await record(l, { type: 'nope' })).why, /not a contribution entry/);
  const e = await release(K.maker, 'a1');
  const { sig, ...noSig } = e; void sig;
  assert.match((await record(l, noSig, { gate: pass })).why, /exactly the fields/);
  assert.match((await record(l, { ...e, extra: 1 }, { gate: pass })).why, /exactly the fields/);
  assert.match((await record(l, { ...e, by: 'nope' }, { gate: pass })).why, /not signed by an Ed25519 key/);
  assert.match((await record(l, { ...e, sig: 'nope' }, { gate: pass })).why, /not signed by an Ed25519 key/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: proof(), at: '2026-10-21 12:00' }, /ISO moment/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: proof(), at: 5 }, /ISO moment/);
  await bad({ type: 'release', asset: 'A1', form: 'card', lineage: [], proofs: proof(), at: T }, /asset id/);
  await bad({ type: 'release', asset: 7, form: 'card', lineage: [], proofs: proof(), at: T }, /asset id/);
  await bad({ type: 'release', asset: 'a1', form: 'token', lineage: [], proofs: proof(), at: T }, /its form is one of/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: 'x', proofs: proof(), at: T }, /lineage/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: ['p', 'p'], proofs: proof(), at: T }, /lineage/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: ['P'], proofs: proof(), at: T }, /lineage/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [3], proofs: proof(), at: T }, /lineage/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: Array.from({ length: 9 }, (_, i) => 'p' + i), proofs: proof(), at: T }, /lineage/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: [], at: T }, /at least one proof/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: [{ kind: 'card', ref: 'x', digest: 'zz' }], at: T }, /at least one proof/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: [{ kind: 'card', ref: '', digest: D('a') }], at: T }, /at least one proof/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: [{ kind: 'Card', ref: 'x', digest: D('a') }], at: T }, /at least one proof/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: [{ kind: 'card', ref: 'x'.repeat(201), digest: D('a') }], at: T }, /at least one proof/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: [{ kind: 'card', ref: 'x', digest: D('a'), more: 1 }], at: T }, /at least one proof/);
  await bad({ type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: Array.from({ length: 17 }, () => proof()[0]), at: T }, /at least one proof/);
  assert.equal((await record(l, await s(K.maker, { type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: Array.from({ length: 16 }, () => proof()[0]), at: T }), { gate: pass })).ok, true);
  assert.equal((await record(l, await s(K.maker, { type: 'release', asset: 'a1', form: 'card', lineage: [], proofs: [{ kind: 'card', ref: 'x'.repeat(200), digest: D('a') }], at: T }), { gate: pass })).ok, true);
  await bad({ type: 'give', asset: 'a1', to: 'nope', at: T }, /names an asset and the Ed25519 key/);
  await bad({ type: 'give', asset: 'A', to: K.owner.pub, at: T }, /names an asset and the Ed25519 key/);
  await bad({ type: 'value', asset: 'A', basis: 'mesh-share', job: 'j1', units: 5, proofs: proof(), at: T }, /names an asset/, K.measurer);
  await bad({ type: 'value', asset: 'a1', basis: 'vibes', job: 'j1', units: 5, proofs: proof(), at: T }, /its basis is one of/, K.measurer);
  await bad({ type: 'value', asset: 'a1', basis: 'mesh-share', job: 'J1', units: 5, proofs: proof(), at: T }, /names the job/, K.measurer);
  await bad({ type: 'value', asset: 'a1', basis: 'mesh-share', job: 7, units: 5, proofs: proof(), at: T }, /names the job/, K.measurer);
  await bad({ type: 'value', asset: 'a1', basis: 'mesh-share', job: 'j1', units: 0, proofs: proof(), at: T }, /at least one/, K.measurer);
  await bad({ type: 'value', asset: 'a1', basis: 'mesh-share', job: 'j1', units: 1e12 + 1, proofs: proof(), at: T }, /at least one/, K.measurer);
  await bad({ type: 'value', asset: 'a1', basis: 'mesh-share', job: 'j1', units: 5, proofs: [], at: T }, /proof that re-measures/, K.measurer);
  await bad({ type: 'switch', path: 'moon', pool: 10, counsel: D('c'), at: T }, /names its path/, K.keeper);
  await bad({ type: 'switch', path: 'fork', pool: 0, counsel: D('c'), at: T }, /pool of whole units/, K.keeper);
  await bad({ type: 'switch', path: 'fork', pool: 1e15 + 1, counsel: D('c'), at: T }, /pool of whole units/, K.keeper);
  await bad({ type: 'switch', path: 'fork', pool: 10, counsel: 'counsel said yes', at: T }, /digest of the counsel/, K.keeper);
  for (const f of FORMS) assert.equal((await record(l, await s(K.maker, { type: 'release', asset: 'f-' + f, form: f, lineage: [], proofs: proof(), at: T }), { gate: pass })).ok, true);
});

test('record: genesis shapes — activators, measurers and a policy that adds up', async () => {
  const bad = async (over, re) => { const r = await record(empty(), await genesisOf(over)); assert.equal(r.ok, false); assert.match(r.why, re); };
  await bad({ activators: [] }, /one to eight activator/);
  await bad({ activators: Array.from({ length: 9 }, () => K.keeper.pub) }, /one to eight activator/);
  await bad({ activators: ['nope'] }, /one to eight activator/);
  await bad({ measurers: 'x' }, /up to 32 measurer/);
  await bad({ measurers: Array.from({ length: 33 }, () => K.keeper.pub) }, /up to 32 measurer/);
  await bad({ measurers: ['nope'] }, /up to 32 measurer/);
  await bad({ policy: { ...POLICY, extra: 1 } }, /policy names/);
  await bad({ policy: { ...POLICY, makerPpm: PPM + 1 } }, /parts of a million/);
  await bad({ policy: { ...POLICY, lineagePpm: PPM + 1 } }, /parts of a million/);
  await bad({ policy: { ...POLICY, makerPpm: 600000, lineagePpm: 400001 } }, /parts of a million/);
  await bad({ policy: { ...POLICY, makerPpm: -1 } }, /parts of a million/);
  await bad({ policy: { ...POLICY, lineagePpm: -1 } }, /parts of a million/);
  await bad({ policy: { ...POLICY, earlyUntil: C.MAX_ENTRIES + 1 } }, /early weight/);
  await bad({ policy: { ...POLICY, earlyNum: 101, earlyDen: 2 } }, /early weight/);
  await bad({ policy: { ...POLICY, earlyNum: 3, earlyDen: 101 } }, /early weight/);
  await bad({ policy: { ...POLICY, earlyNum: 1, earlyDen: 0 } }, /early weight/);
  await bad({ policy: { ...POLICY, earlyNum: 1, earlyDen: 2 } }, /early weight/);
  const ok = async (over) => assert.equal((await record(empty(), await genesisOf(over))).ok, true);
  await ok({ policy: { ...POLICY, makerPpm: 600000, lineagePpm: 400000 } });
  await ok({ policy: { ...POLICY, earlyNum: 1, earlyDen: 1, earlyUntil: 0 } });
  await ok({ policy: { ...POLICY, earlyNum: 100, earlyDen: 100, earlyUntil: C.MAX_ENTRIES } });
  await ok({ activators: Array.from({ length: 8 }, () => K.keeper.pub), measurers: Array.from({ length: 32 }, () => K.measurer.pub) });
  await ok({ measurers: [] });
});

test('record: first release wins, parents must be recorded, the gate must re-run', async () => {
  const l = await chain([await genesisOf(), await release(K.maker, 'a1')]);
  assert.match((await record(l, await release(K.maker2, 'a1'), { gate: pass })).why, /released already: the first release recorded wins/);
  assert.match((await record(l, await release(K.maker, 'c1', { lineage: ['a1', 'zz'] }), { gate: pass })).why, /parent zz is not recorded/);
  assert.equal((await record(l, await release(K.maker, 'c1', { lineage: ['a1'] }), { gate: pass })).ok, true);
  let eight = l;
  for (let i = 0; i < 7; i++) eight = (await record(eight, await release(K.maker, 'p' + i), { gate: pass })).ledger;
  assert.equal((await record(eight, await release(K.maker, 'c8', { lineage: ['a1', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'] }), { gate: pass })).ok, true);   // eight parents is the most
  const e = await release(K.maker, 'a2');
  assert.match((await record(l, e)).why, /no gate was given/);
  assert.match((await record(l, e, { gate: () => ({ ok: false, why: 'the card does not read' }) })).why, /its gate did not pass: the card does not read/);
  assert.match((await record(l, e, { gate: () => ({ ok: false }) })).why, /no reason given/);
  assert.match((await record(l, e, { gate: () => null })).why, /gate did not pass/);
  assert.match((await record(l, e, { gate: () => ({ ok: 'yes' }) })).why, /gate did not pass/);
  assert.match((await record(l, e, { gate: () => { throw new Error('boom'); } })).why, /gate did not pass/);
  let seen = null;
  const r = await record(l, e, { gate: async (x, led) => { seen = [x.asset, led.log.length]; return { ok: true }; } });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, ['a2', 2]);
  const a = r.ledger.assets.a2;
  assert.deepEqual([a.maker, a.owner, a.form, a.at], [K.maker.pub, K.maker.pub, 'card', 2]);
});

test('record: a give is the owner’s of the moment; a give from a former owner is a double sale', async () => {
  let l = await chain([await genesisOf(), await release(K.maker, 'a1')]);
  assert.match((await record(l, await give(K.maker, 'zz', K.owner.pub))).why, /not recorded here/);
  assert.match((await record(l, await give(K.stranger, 'a1', K.owner.pub))).why, /only its owner of this moment/);
  assert.match((await record(l, await give(K.maker, 'a1', K.maker.pub))).why, /another key/);
  const r = await record(l, await give(K.maker, 'a1', K.owner.pub));
  assert.equal(r.ok, true, r.why);
  l = r.ledger;
  assert.equal(l.assets.a1.owner, K.owner.pub);
  assert.deepEqual(l.assets.a1.owners, [[1, K.maker.pub], [2, K.owner.pub]]);
  assert.match((await record(l, await give(K.maker, 'a1', K.friend.pub, { at: '2026-10-21T12:00:01Z' }))).why, /double sale/);
  assert.equal((await record(l, await give(K.owner, 'a1', K.friend.pub))).ok, true);
});

test('record: values are a named measurer’s, gated, and never counted twice', async () => {
  const l = await chain([await genesisOf(), await release(K.maker, 'a1')]);
  assert.match((await record(l, await value('zz', 'j1', 5), { gate: pass })).why, /not recorded here/);
  assert.match((await record(l, await s(K.stranger, { type: 'value', asset: 'a1', basis: 'mesh-share', job: 'j1', units: 5, proofs: proof(), at: T }), { gate: pass })).why, /measurer the genesis names/);
  assert.match((await record(l, await value('a1', 'j1', 5))).why, /no gate was given/);
  const r = await record(l, await value('a1', 'j1', 5), { gate: pass });
  assert.equal(r.ok, true, r.why);
  assert.match((await record(r.ledger, await value('a1', 'j1', 6), { gate: pass })).why, /recorded already: nothing is counted twice/);
  assert.equal((await record(r.ledger, await value('a1', 'j2', 6), { gate: pass })).ok, true);
  assert.equal((await record(r.ledger, await value('a1', 'j1', 6, { basis: 'usage' }), { gate: pass })).ok, true);
  for (const b of BASES) assert.equal((await record(l, await value('a1', 'jb', 1, { basis: b }), { gate: pass })).ok, true);
});

test('record: the switch is an activator’s, once', async () => {
  const l = await chain([await genesisOf()]);
  const sw = (keys) => s(keys, { type: 'switch', path: 'fork', pool: 1000, counsel: D('c'), at: T });
  assert.match((await record(l, await sw(K.stranger))).why, /only an activator/);
  const r = await record(l, await sw(K.keeper));
  assert.equal(r.ok, true, r.why);
  assert.equal(r.ledger.switch, 1);
  assert.equal(l.switch, null);
  assert.match((await record(r.ledger, await s(K.keeper, { type: 'switch', path: 'network', pool: 5, counsel: D('d'), at: T }))).why, /recorded already/);
  assert.equal((await record(l, await s(K.keeper, { type: 'switch', path: 'network', pool: 1, counsel: D('d'), at: T }))).ok, true);   // a pool of one unit is the least
});

test('record and replay: junk is refused, never thrown', async () => {
  const l = await chain([await genesisOf()]);
  for (const junk of [undefined, 1, 'x', [], {}, { type: 'release' }, { type: 'give', by: 1 }]) assert.equal((await record(l, junk)).ok, false);
  for (const led of [null, {}, { schema: SCHEMA }, { schema: 'other', log: [] }, { schema: SCHEMA, log: 'x' }]) assert.match((await record(led, await genesisOf())).why, /not a contribution ledger/);
  assert.match((await record({ schema: SCHEMA, log: new Array(C.MAX_ENTRIES) }, await genesisOf())).why, /full/);
  assert.equal((await record({ ...l, assets: null }, await release(K.maker, 'a1'), { gate: pass })).ok, false);
  for (const log of [null, 'x', {}, [1], [{ n: 0 }]]) assert.equal((await replay(log)).ok, false);
});

test('replay: the log re-records from nothing to the same head; a moved or altered link is refused', async () => {
  const l = await chain([await genesisOf(), await release(K.maker, 'a1'), await give(K.maker, 'a1', K.owner.pub), await value('a1', 'j1', 7)]);
  const r = await replay(l.log, { gate: pass });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.ledger.head, l.head);
  assert.deepEqual(r.ledger.assets, l.assets);
  const swapped = [l.log[0], l.log[2], l.log[1], l.log[3]];
  assert.match((await replay(swapped, { gate: pass })).why, /entry 1 is not linked/);
  const renumbered = l.log.map((x, k) => (k === 1 ? { ...x, n: 5 } : x));
  assert.match((await replay(renumbered, { gate: pass })).why, /entry 1 is not linked/);
  const reprev = l.log.map((x, k) => (k === 3 ? { ...x, prev: ZERO } : x));
  assert.match((await replay(reprev, { gate: pass })).why, /entry 3 is not linked/);
  assert.match((await replay(l.log)).why, /entry 1: .*no gate was given/);
  assert.match((await replay(l.log.map((x) => ({ ...x, extra: 1 })), { gate: pass })).why, /entry 0 is not linked/);
  assert.equal((await replay([], { gate: pass })).ok, true);
  assert.match((await replay({ length: C.MAX_ENTRIES + 1 })).why, /list of linked/);
  assert.match((await replay(new Array(C.MAX_ENTRIES + 1))).why, /list of linked/);
  assert.match((await replay(new Array(C.MAX_ENTRIES))).why, /entry 0 is not linked/);   // the most a log may hold is read
});

test('ownerAt: the owner of record at each moment', async () => {
  const l = await chain([await genesisOf(), await release(K.maker, 'a1'), await give(K.maker, 'a1', K.owner.pub), await give(K.owner, 'a1', K.friend.pub)]);
  assert.equal(ownerAt(l, 'a1', 1), K.maker.pub);
  assert.equal(ownerAt(l, 'a1', 2), K.owner.pub);
  assert.equal(ownerAt(l, 'a1', 3), K.friend.pub);
  assert.equal(ownerAt(l, 'a1', 99), K.friend.pub);
  assert.equal(ownerAt(l, 'a1', 0), null);
  assert.equal(ownerAt(l, 'zz', 2), null);
  assert.equal(ownerAt(l, 'a1', 1.5), null);
  assert.equal(ownerAt(null, 'a1', 1), null);
  assert.equal(ownerAt({}, 'a1', 1), null);
});

test('credits: the owner of the moment, the maker’s part, the parents’ part, the early weight — exact', async () => {
  // 0 genesis · 1 a1 by maker · 2 b1 by maker2 · 3 child c1 of a1 and b1 by owner · 4 value c1 (early: n <= 3? no, 4) ...
  const l = await chain([await genesisOf(), await release(K.maker, 'a1'), await release(K.maker2, 'b1'), await value('a1', 'j0', 1000),
    await release(K.owner, 'c1', { lineage: ['a1', 'b1'] }), await value('c1', 'j1', 1000), await give(K.owner, 'c1', K.friend.pub), await value('c1', 'j2', 999)]);
  const c = credits(l);
  assert.equal(c.ok, true);
  assert.equal(c.scale, 2);
  // value at n=3 (early, weight 3): a1 units 3000 → maker 300, owner (also maker) 2700, no parents
  // value at n=5 (weight 2): 2000 → maker (owner) 200, parents 100 → 50 each, owner 1700
  // value at n=7 (weight 2): 1998 → maker 199, parents floor(99.9)=99 → 49 each, owner friend 1998 − 199 − 98 = 1701
  assert.equal(c.credits[K.maker.pub], String(300 + 2700 + 50 + 49));
  assert.equal(c.credits[K.maker2.pub], String(50 + 49));
  assert.equal(c.credits[K.owner.pub], String(200 + 1700 + 199));
  assert.equal(c.credits[K.friend.pub], '1701');
  assert.deepEqual(c.lines.filter((x) => x.n === 7).map((x) => [x.role, x.key === K.friend.pub, x.credit]), [['maker', false, '199'], ['parent', false, '49'], ['parent', false, '49'], ['owner', true, '1701']]);
  assert.deepEqual(c.lines[0], { n: 3, asset: 'a1', basis: 'mesh-share', job: 'j0', key: K.maker.pub, role: 'maker', credit: '300' });
  assert.equal(credits(null).ok, false);
  assert.equal(credits(empty()).ok, false);
  assert.equal(credits({ schema: 'x', genesis: {} }).ok, false);
});

test('credits: the early weight ends exactly at its position; a zero part writes no line', async () => {
  const g = await genesisOf({ policy: { makerPpm: 0, lineagePpm: 0, earlyUntil: 2, earlyNum: 5, earlyDen: 1 } });
  const l = await chain([g, await release(K.maker, 'a1'), await value('a1', 'j1', 10), await value('a1', 'j2', 10)]);
  const c = credits(l);
  assert.equal(c.credits[K.maker.pub], String(50 + 10));
  assert.deepEqual(c.lines.map((x) => [x.n, x.role, x.credit]), [[2, 'owner', '50'], [3, 'owner', '10']]);
  const big = await chain([g, await release(K.maker, 'a1'), await value('a1', 'j1', 1e12)]);
  assert.equal(credits(big).credits[K.maker.pub], '5000000000000');
});

test('allocate: off unless the switch is recorded; a sandbox allocation for anyone; parts sum to the pool', async () => {
  const l = await chain([await genesisOf({ policy: { ...POLICY, makerPpm: 0, lineagePpm: 0, earlyUntil: 0 } }), await release(K.maker, 'a1'), await release(K.maker2, 'b1'), await release(K.owner, 'c1'),
    await value('a1', 'j1', 1), await value('b1', 'j1', 1), await value('c1', 'j1', 1)]);
  assert.match(allocate(l).why, /the switch is off/);
  assert.match(allocate(l, { sandbox: 'yes', pool: 10 }).why, /the switch is off/);
  assert.match(allocate(l, { sandbox: true }).why, /a pool is a whole number/);
  assert.match(allocate(l, { sandbox: true, pool: 0 }).why, /a pool is a whole number/);
  assert.match(allocate(l, { sandbox: true, pool: 1e15 + 1 }).why, /a pool is a whole number/);
  assert.equal(allocate(l, { sandbox: true, pool: 1e15 }).ok, true);
  const a = allocate(l, { sandbox: true, pool: 10 });
  assert.equal(a.ok, true);
  assert.equal(a.sandbox, true);
  assert.equal(a.total, 10);
  // three equal credits of 10: 3 each, and the one left goes to the smallest key (ties by key)
  const keys = [K.maker.pub, K.maker2.pub, K.owner.pub].sort();
  assert.deepEqual(keys.map((k) => a.parts[k]), [4, 3, 3]);
  assert.equal(allocate(l, { sandbox: true, pool: 1 }).parts[keys[0]], 1);
  const on = (await record(l, await s(K.keeper, { type: 'switch', path: 'fork', pool: 7, counsel: D('c'), at: T }))).ledger;
  const live = allocate(on);
  assert.equal(live.ok, true);
  assert.equal(live.sandbox, false);
  assert.equal(live.pool, 7);
  assert.deepEqual(keys.map((k) => live.parts[k]), [3, 2, 2]);
  assert.equal(allocate(on, { sandbox: true, pool: 30 }).pool, 30);
  assert.equal(allocate(null).ok, false);
});

test('allocate: proportional to credit, the remainder to the largest fractions, empty with no values', async () => {
  const l = await chain([await genesisOf({ policy: { ...POLICY, makerPpm: 0, lineagePpm: 0, earlyUntil: 0 } }), await release(K.maker, 'a1'), await release(K.maker2, 'b1'),
    await value('a1', 'j1', 2), await value('b1', 'j1', 1)]);
  const a = allocate(l, { sandbox: true, pool: 100 });
  assert.equal(a.parts[K.maker.pub], 67);   // 66.67 → 66, then the larger remainder gets the one left
  assert.equal(a.parts[K.maker2.pub], 33);
  assert.equal(a.total, 100);
  const none = await chain([await genesisOf(), await release(K.maker, 'a1')]);
  assert.deepEqual(allocate(none, { sandbox: true, pool: 50 }), { ok: true, sandbox: true, pool: 50, parts: {}, total: 0 });
});

test('shareOf: a contributor’s part and every line behind it', async () => {
  const l = await chain([await genesisOf(), await release(K.maker, 'a1'), await give(K.maker, 'a1', K.owner.pub), await value('a1', 'j1', 100)]);
  const s1 = shareOf(l, K.owner.pub, { sandbox: true, pool: 1000 });
  assert.equal(s1.ok, true);
  assert.equal(s1.key, K.owner.pub);
  assert.equal(s1.pool, 1000);
  assert.equal(s1.sandbox, true);
  assert.equal(s1.credit, '270');   // the value is entry 3, inside the early weight (3 / 2): 300 units, the maker's tenth (30) aside
  assert.equal(s1.lines.length, 1);
  assert.equal(s1.lines[0].role, 'owner');
  assert.equal(s1.part + shareOf(l, K.maker.pub, { sandbox: true, pool: 1000 }).part, 1000);
  assert.deepEqual(shareOf(l, K.stranger.pub, { sandbox: true, pool: 1000 }), { ok: true, key: K.stranger.pub, credit: '0', part: 0, pool: 1000, sandbox: true, lines: [] });
  assert.match(shareOf(l, 'nope', { sandbox: true, pool: 1 }).why, /Ed25519 public key/);
  assert.match(shareOf(l, K.owner.pub).why, /switch is off/);
  assert.equal(shareOf(empty(), K.owner.pub, { sandbox: true, pool: 1 }).ok, false);
});

test('reconcile: one economy merges, entries counted once, conflicts refused and named', async () => {
  const g = await genesisOf(), r1 = await release(K.maker, 'a1'), g1 = await give(K.maker, 'a1', K.owner.pub), v1 = await value('a1', 'j1', 10);
  const main = await chain([g, r1]);
  const fork = await chain([g, r1, g1, v1, await release(K.maker2, 'b1')]);
  const m = await reconcile(main, fork, { gate: pass });
  assert.equal(m.ok, true, m.why);
  assert.deepEqual([m.added, m.skipped, m.refused.length], [3, 2, 0]);
  assert.equal(m.ledger.assets.a1.owner, K.owner.pub);
  const again = await reconcile(m.ledger, fork, { gate: pass });
  assert.deepEqual([again.added, again.skipped], [0, 5]);
  assert.equal(again.ledger.head, m.ledger.head);
  // the main ledger has sold a1 elsewhere: the fork's give from the maker is a double sale there
  const sold = await chain([g, r1, await give(K.maker, 'a1', K.friend.pub)]);
  const c = await reconcile(sold, fork, { gate: pass });
  assert.equal(c.ok, true);
  assert.equal(c.added, 2);
  assert.equal(c.refused.length, 1);
  assert.equal(c.refused[0].n, 2);
  assert.match(c.refused[0].why, /double sale/);
  const other = await chain([await genesisOf({ measurers: [] })]);
  assert.match((await reconcile(other, fork, { gate: pass })).why, /different geneses/);
  assert.match((await reconcile(empty(), fork, { gate: pass })).why, /begin with a genesis/);
  assert.match((await reconcile(fork, empty(), { gate: pass })).why, /begin with a genesis/);
  assert.match((await reconcile(null, fork)).why, /both must be contribution ledgers/);
  assert.match((await reconcile(fork, { schema: 'x' })).why, /both must be contribution ledgers/);
  assert.match((await reconcile(fork, null)).why, /both must be contribution ledgers/);
  assert.match((await reconcile({ ...fork, schema: 'x' }, fork)).why, /both must be contribution ledgers/);
  assert.match((await reconcile(fork, { ...fork, schema: 'x' })).why, /both must be contribution ledgers/);
  const ungated = await reconcile(main, fork);
  assert.equal(ungated.refused.length, 2);   // the value and the release need their gate; the give does not
});

test('no money verb in the exported surface: the switch makes no payment, nothing leaves the ledger', () => {
  const names = Object.keys(C);
  for (const n of names) assert.doesNotMatch(n, /fiat|trade|exchange|withdraw|sell|convert|cash|buy|pay|transfer|airdrop|activate/i);
  assert.deepEqual(names.sort(), ['BASES', 'FORMS', 'MAX_ENTRIES', 'PPM', 'SCHEMA', 'ZERO', 'allocate', 'canonical', 'credits', 'empty', 'idOf', 'keysFromPhrase', 'keysFromSeed', 'ownerAt', 'reconcile', 'record', 'replay', 'sha256', 'shareOf', 'sign']);
});
