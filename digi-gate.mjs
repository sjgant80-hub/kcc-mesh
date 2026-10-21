// digi-gate.mjs — the gate for the DIGI drop's contributions: an entry counts only if the DIGI repository's own records
// say what it says. One module, used by tools/seed-digi.mjs when it writes ledger/digi.json and by the page when it
// replays that ledger in a browser against the live DIGI site, so both run the very same check.
//   release  its proof is a card's line in drop/manifest.json, by hash: the line names this card, at this serial, the
//            drop's maker released it, and its GATE score clears the drop's bar
//   value    its proof is one business's mesh in data/organ-6/record.json, by hash: the mesh's shares sum to a million,
//            and it measured exactly this share for this card
import { canonical, sha256 } from './contrib.mjs';

/** gateOf(manifest, organ6) → gate(entry) → { ok } | { ok: false, why } */
export async function gateOf(manifest, organ6) {
  const cards = new Map([[manifest.first.card, { ...manifest.first, serial: 1 }], ...manifest.cards.map((c) => [c.card, c])]);
  const meshes = new Map(organ6.meshes.map((m) => [m.set, m]));
  const digest = (x) => sha256(canonical(x));
  return async (e) => {
    const p = e.proofs[0];
    if (e.type === 'release') {
      const c = cards.get(e.asset.replace(/^digi:/, ''));
      if (!c || p.kind !== 'digi-drop' || p.ref !== 'digi-card/drop/manifest.json#' + c.serial) return { ok: false, why: 'the drop has no such card' };
      if (p.digest !== (await digest(c))) return { ok: false, why: 'the card’s line in the manifest is not the one this proof hashed' };
      if (e.by !== manifest.maker) return { ok: false, why: 'it was not released by the drop’s maker' };
      return c.gate >= Math.round(manifest.bar * 1e6) ? { ok: true } : { ok: false, why: 'its GATE score is under the drop’s bar' };
    }
    const set = e.job.replace(/^organ6-/, ''), m = meshes.get(set);
    if (!m || p.kind !== 'digi-organ' || p.ref !== 'digi-card/data/organ-6/record.json#' + set) return { ok: false, why: 'organ 6 measured no such mesh' };
    if (p.digest !== (await digest(m))) return { ok: false, why: 'the mesh’s record is not the one this proof hashed' };
    if (m.shareSum !== 1000000) return { ok: false, why: 'the mesh’s shares do not sum to a million' };
    const x = m.members.find((y) => 'digi:' + y.card === e.asset);
    return x && x.share === e.units ? { ok: true } : { ok: false, why: 'organ 6 did not measure this share for this card' };
  };
}
