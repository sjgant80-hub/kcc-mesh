// contrib-ui.mjs — the contribution ledger, on the page: ledger/digi.json replayed in this browser from nothing — every
// signature checked, every entry's gate re-run against the live DIGI drop's own records (same site, so fetched from
// ../digi-card/) — then the sandbox allocation anyone can compute, one contributor's line items, a tampered copy
// refused, and a reconcile of two copies. The switch is off: the page computes sandbox allocations only.
import { replay, allocate, shareOf, credits, reconcile, keysFromPhrase } from './contrib.mjs';
import { gateOf } from './digi-gate.mjs';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; };
const fill = (n, ...kids) => n.replaceChildren(...kids.flat().filter((k) => k != null).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
const short = (k) => k.slice(0, 8) + '…' + k.slice(-4);
const say = (t, bad = false) => fill($('#c-status'), el('span', { class: bad ? 'bad' : '' }, t));
const S = { ledger: null, log: null, names: new Map(), gate: null };

async function names(manifest) {
  S.names.set(manifest.maker, 'the DIGI drop’s maker (demo key)');
  for (const set of ['telco', 'shop', 'bank', 'adult', 'credit']) for (let k = 0; k < 12; k++) S.names.set((await keysFromPhrase('digi-card/organs/owner/mesh-' + set + '-' + k)).pub, set + ' owner ' + (k + 1) + ' (demo key)');
}
const who = (k) => S.names.get(k) || short(k);

async function load() {
  try {
    say('Fetching the ledger and the DIGI drop’s records…');
    const [led, manifest, organ6] = await Promise.all(['ledger/digi.json', '../digi-card/drop/manifest.json', '../digi-card/data/organ-6/record.json'].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' did not load'); return r.json(); })));
    S.gate = await gateOf(manifest, organ6);
    await names(manifest);
    say('Replaying ' + led.log.length.toLocaleString() + ' entries from nothing: every signature checked, every gate re-run against the DIGI records…');
    const t0 = performance.now(), r = await replay(led.log, { gate: S.gate });
    if (!r.ok) return say('✗ The ledger does not replay: ' + r.why, true);
    if (r.ledger.head !== led.head) return say('✗ It replays to another head than the file names', true);
    S.ledger = r.ledger; S.log = led.log;
    const count = (t) => led.log.filter((x) => x.entry.type === t).length;
    say('✓ Replayed here in ' + Math.round(performance.now() - t0).toLocaleString() + ' ms: ' + led.log.length.toLocaleString() + ' entries, every signature and every gate holds. Head ' + r.ledger.head.slice(0, 16) + '…');
    fill($('#c-stats'), [['releases', count('release')], ['gives', count('give')], ['measured values', count('value')], ['the switch', r.ledger.switch === null ? 'off' : 'on']].map(([k, v]) => el('div', { class: 'stat' }, el('span', {}, k), el('b', {}, String(v)))));
    const p = r.ledger.genesis.policy;
    fill($('#c-policy'), 'Sealed in its genesis, before any record it weighs (a demo policy — the real one is the ledger owner’s): the maker keeps ' + p.makerPpm / 1e4 + '% of every value its assets earn, the parents of a child share ' + p.lineagePpm / 1e4 + '%, the owner of the moment the rest; entries up to position ' + p.earlyUntil.toLocaleString() + ' weigh ' + p.earlyNum + '/' + p.earlyDen + '.');
    allocateNow();
  } catch (e) { say('✗ ' + (e.message || e), true); }
}

function allocateNow() {
  if (!S.ledger) return;
  const pool = Math.round(Number($('#c-pool').value) || 0), a = allocate(S.ledger, { sandbox: true, pool }), c = credits(S.ledger);
  if (!a.ok) return fill($('#c-alloc'), el('p', { class: 'bad' }, a.why));
  const rows = Object.entries(a.parts).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  fill($('#c-alloc'), el('p', { class: 'note' }, 'Sandbox: computed here, by anyone, from the ledger alone. A live allocation needs the switch, and this ledger holds none: ', el('b', {}, allocate(S.ledger).why)),
    el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'contributor'), el('th', { class: 'n' }, 'credit'), el('th', { class: 'n' }, 'part of ' + a.pool.toLocaleString()))),
      el('tbody', {}, rows.map(([k, part]) => el('tr', {}, el('td', {}, el('button', { class: 'linkish', onclick: () => lines(k) }, who(k))), el('td', { class: 'n' }, BigInt(c.credits[k]).toLocaleString()), el('td', { class: 'n' }, part.toLocaleString()))))),
    el('p', { class: 'dim' }, 'The parts sum to the pool exactly: ' + a.total.toLocaleString() + '. Press a contributor for every line behind their part.'));
}

function lines(k) {
  const pool = Math.round(Number($('#c-pool').value) || 0), s = shareOf(S.ledger, k, { sandbox: true, pool });
  if (!s.ok) return fill($('#c-lines'), el('p', { class: 'bad' }, s.why));
  fill($('#c-lines'), el('h3', {}, who(k) + ' · part ' + s.part.toLocaleString() + ' of ' + s.pool.toLocaleString()),
    el('table', {}, el('thead', {}, el('tr', {}, ['entry', 'asset', 'job', 'as', 'credit'].map((h) => el('th', {}, h)))),
      el('tbody', {}, s.lines.map((x) => el('tr', {}, el('td', {}, String(x.n)), el('td', {}, x.asset.replace('digi:', '')), el('td', {}, x.job), el('td', {}, x.role), el('td', { class: 'n' }, BigInt(x.credit).toLocaleString()))))));
}

async function tamper() {
  if (!S.log) return;
  const k = S.log.findIndex((x) => x.entry.type === 'value'), copy = S.log.map((x, i) => (i === k ? { ...x, entry: { ...x.entry, units: x.entry.units + 1 } } : x));
  const r = await replay(copy, { gate: S.gate });
  fill($('#c-tamper'), el('p', { class: r.ok ? 'bad' : 'good' }, r.ok ? '✗ A tampered copy replayed — this should never happen' : '✓ One measured value raised by a single unit: refused — ' + r.why));
}

async function merge() {
  if (!S.log) return;
  const half = await replay(S.log.slice(0, Math.floor(S.log.length * 0.6)), { gate: S.gate });
  const m = await reconcile(half.ledger, S.ledger, { gate: S.gate });
  fill($('#c-merge'), el('p', { class: m.ok && !m.refused.length ? 'good' : 'bad' }, m.ok ? '✓ A copy holding the first ' + half.ledger.log.length.toLocaleString() + ' entries took in the full ledger: ' + m.added.toLocaleString() + ' added, ' + m.skipped.toLocaleString() + ' already held and counted once, ' + m.refused.length + ' refused. Same head: ' + (m.ledger.head === S.ledger.head ? 'yes' : 'no') + '.' : '✗ ' + m.why));
}

$('#c-alloc-go').addEventListener('click', allocateNow);
$('#c-tamper-go').addEventListener('click', tamper);
$('#c-merge-go').addEventListener('click', merge);
load();
