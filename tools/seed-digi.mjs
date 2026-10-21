#!/usr/bin/env node
// tools/seed-digi.mjs — the first real contributions: the DIGI drop and its measured mesh, written into a contribution
// ledger (ledger/digi.json) by contrib.mjs, every entry gated against the DIGI repository's own records.
//
//   release  each of the 1,000 genesis cards, signed by the drop's maker key (digi-card's public demo phrase), its proof
//            the card's line in drop/manifest.json (by hash); its gate: that line names this card, this serial, this
//            maker, and a GATE score at or over the drop's bar
//   give     each card organ 6 fielded in a business's mesh, from the maker to the demo owner organ 6 handed it to
//   value    each fielded card's measured share of its mesh (leave-one-out, parts of a million; a share of nothing is not recorded) from
//            data/organ-6/record.json (by hash); its gate: the record holds this card with exactly this share, and the
//            mesh's shares sum to a million
//
// The keys are demo keys from public phrases, as in the DIGI drop, so anyone can reproduce every signature (Ed25519 is
// deterministic: the same entry under the same key signs to the same bytes) — and so the ledger file regenerates byte
// for byte (`--check`). The policy in its genesis is a DEMO policy: the real one is the ledger owner's to set.
//   node tools/seed-digi.mjs [--digi <path to a digi-card checkout>] [--check]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { canonical, sha256, keysFromPhrase, sign, empty, record } from '../contrib.mjs';
import { gateOf } from '../digi-gate.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIGI = arg('--digi', 'C:/Users/sjgan/digi-card'), OUT = new URL('../ledger/digi.json', import.meta.url);
const read = (p) => JSON.parse(readFileSync(join(DIGI, p), 'utf8'));
const born = (p) => new Date(execFileSync('git', ['-C', DIGI, 'log', '--diff-filter=A', '--format=%cI', '--', p], { encoding: 'utf8' }).trim().split('\n').pop()).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const POLICY = { makerPpm: 100000, lineagePpm: 50000, earlyUntil: 5000, earlyNum: 3, earlyDen: 2 };

async function main() {
  const manifest = read('drop/manifest.json'), organ6 = read('data/organ-6/record.json');
  const dropAt = born('drop/manifest.json'), meshAt = born('data/organ-6/record.json');
  const keeper = await keysFromPhrase('kcc-mesh/demo/keeper'), measurer = await keysFromPhrase('kcc-mesh/demo/measurer');
  const maker = await keysFromPhrase('digi-card/genesis/demo-maker');   // the DIGI drop's own public demo maker key
  if (maker.pub !== manifest.maker) throw new Error('the demo maker phrase does not give the drop’s maker key');
  const gate = await gateOf(manifest, organ6);
  let l = empty();
  const put = async (keys, fields) => { const s = await sign(keys, fields); if (!s.ok) throw new Error(s.why); const r = await record(l, s.entry, { gate }); if (!r.ok) throw new Error(r.why); l = r.ledger; };
  await put(keeper, { type: 'genesis', activators: [keeper.pub], measurers: [measurer.pub], policy: POLICY });
  const all = [{ ...manifest.first, serial: 1 }, ...manifest.cards].sort((a, b) => a.serial - b.serial);
  for (const c of all) await put(maker, { type: 'release', asset: 'digi:' + c.card, form: 'card', lineage: [], proofs: [{ kind: 'digi-drop', ref: 'digi-card/drop/manifest.json#' + c.serial, digest: await sha256(canonical(c)) }], at: dropAt });
  // the owners organ 6 handed each business's cards to: for each department in the drop's order, its three best cards
  const order = [...new Set(manifest.cards.map((c) => c.domain))];
  for (const m of organ6.meshes) {
    const owners = new Map();
    let k = 0;
    for (const dom of order.filter((d) => d.startsWith(m.set + '-'))) for (const c of manifest.cards.filter((x) => x.domain === dom).sort((a, b) => b.gate - a.gate || a.serial - b.serial).slice(0, 3)) owners.set(c.card, await keysFromPhrase('digi-card/organs/owner/mesh-' + m.set + '-' + k++));
    const digest = await sha256(canonical(m));
    for (const x of m.members) {
      const o = owners.get(x.card);
      if (!o) throw new Error('organ 6 fielded a card the owners’ order does not reach: ' + x.card);
      await put(maker, { type: 'give', asset: 'digi:' + x.card, to: o.pub, at: meshAt });
      if (x.share === 0) continue;   // fielded, but its measured share is nothing: there is no value to record
      await put(measurer, { type: 'value', asset: 'digi:' + x.card, basis: 'mesh-share', job: 'organ6-' + m.set, units: x.share, proofs: [{ kind: 'digi-organ', ref: 'digi-card/data/organ-6/record.json#' + m.set, digest }], at: meshAt });
    }
  }
  const text = JSON.stringify({ schema: l.schema, note: 'The DIGI drop and its measured mesh as contributions, every entry gated against the DIGI records it names. Demo keys from public phrases; a demo policy. Internal contribution units, not money; the switch is off.', head: l.head, log: l.log }) + '\n';
  if (process.argv.includes('--check')) {
    const was = readFileSync(OUT, 'utf8');
    console.log(was === text ? 'SEED OK · ledger/digi.json regenerates byte for byte · ' + l.log.length + ' entries · head ' + l.head.slice(0, 16) : 'SEED BROKEN · ledger/digi.json does not regenerate (head ' + l.head.slice(0, 16) + ')');
    process.exit(was === text ? 0 : 1);
  }
  mkdirSync(new URL('../ledger/', import.meta.url), { recursive: true });
  writeFileSync(OUT, text);
  console.log('wrote ledger/digi.json · ' + l.log.length + ' entries · head ' + l.head.slice(0, 16));
}
if (process.argv[1] && process.argv[1].endsWith('seed-digi.mjs')) await main();
