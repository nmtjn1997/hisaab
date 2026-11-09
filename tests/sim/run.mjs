// Multi-phone live-group test against the real sync server.
//   node tests/sim/run.mjs nainital   -> replay the Nainital trip from 2 phones, compare with the chat report
//   node tests/sim/run.mjs stress     -> 5 phones, skewed clocks, concurrent adds/edits/deletes on the same rows
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';

const mode = process.argv[2] || 'nainital';
const rupee = (p) => '₹' + (p / 100).toLocaleString('en-IN');

function phone(name, skew = 0) {
  const w = new Worker(new URL('./phone.mjs', import.meta.url), { workerData: { name, skew } });
  let n = 0;
  const wait = new Map();
  const ready = new Promise((r) => w.once('message', r));
  w.on('message', (m) => { if (m.id && wait.has(m.id)) { const { res, rej } = wait.get(m.id); wait.delete(m.id); m.ok ? res(m.res) : rej(new Error(`${name}: ${m.err}`)); } });
  const call = (op, args) => new Promise((res, rej) => { const id = ++n; wait.set(id, { res, rej }); w.postMessage({ id, op, args }); });
  return { name, ready, call, stop: () => w.terminate() };
}

async function converge(phones) {
  for (let round = 0; round < 2; round++) for (const p of phones) await p.call('settle');
  const dumps = await Promise.all(phones.map((p) => p.call('dump')));
  const ref = dumps[0].canon.join('\n');
  dumps.forEach((d, i) => {
    if (d.canon.join('\n') === ref) return;
    const A = new Set(dumps[0].canon), B = new Set(d.canon);
    console.log(`\n${phones[0].name} only:`, [...A].filter((x) => !B.has(x)));
    console.log(`${phones[i].name} only:`, [...B].filter((x) => !A.has(x)));
    assert.fail(`${phones[i].name} differs from ${phones[0].name}`);
  });
  return dumps;
}

async function nainital() {
  const namit = phone('Namit', 0), deepak = phone('Deepak', -4 * 60 * 1000); // Deepak's clock is 4 minutes slow
  await Promise.all([namit.ready, deepak.ready]);
  const g = await namit.call('create', { name: 'Nainital trip', me: 'Namit', others: ['Jeeju'] });
  console.log(`Group live: ${g.gid}. Deepak joins from the invite link as Jeeju (clock 4 min slow).`);
  await deepak.call('join', { gid: g.gid, key: g.key, as: g.people.Jeeju });

  // Each person adds what THEY paid, from their own phone, written the way the chat has it.
  const namitLines = ['700 - burger - namit', '8000 - jim corbett room - namit', '6000 - safari - namit', '500 - waterfall and cave - namit', '1000 - corbett key lost - namit', '950 - shopping - namit personal', '910 - food sunday nainital night - namit', '6600 - nainital room checkout - namit', '700 - video - namit', '400 - governor house - namit', '2690 - petrol remaining - namit'];
  const deepakLines = ['3810 petrol - me', '5000 - nainital room half - me', '350 - waterfall and cave - me', '1560 - ropeway - me', '1000 - 360 view - me', '2060 - last day food - me'];
  // Interleave and fire in parallel bursts: both phones writing at the same moment.
  const t0 = performance.now();
  for (let i = 0; i < Math.max(namitLines.length, deepakLines.length); i++) {
    await Promise.all([namitLines[i] && namit.call('add', { text: namitLines[i] }), deepakLines[i] && deepak.call('add', { text: deepakLines[i] })].filter(Boolean));
  }
  console.log(`17 expenses added from 2 phones in parallel in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // Someone quietly lowers Safari and drops themselves from it; then it is put back.
  const ids = await deepak.call('ids');
  const dn = await converge([namit, deepak]);
  const safari = dn[0].canon.find((c) => c.includes('|Safari|')).split('|')[0];
  await deepak.call('edit', { id: safari, amount: 400000, removeMe: true });
  await namit.call('settle');
  console.log('Deepak is a member, so the server refused his edit of Namit\'s Safari entry.');
  const dumps = await converge([namit, deepak]);
  const [a] = dumps;
  console.log(`\nBoth phones identical: ${a.count} expenses, total ${rupee(a.total)}`);
  console.log('Balances:', Object.fromEntries(Object.entries(a.balances).map(([k, v]) => [k, (v > 0 ? '+' : '') + rupee(v)])));
  const owe = -a.balances.Jeeju;
  console.log(`Hisaab: Jeeju (Deepak) pays Namit ${rupee(owe)}. Chat report said ₹6,110.`);
  const flagged = a.history.filter((h) => h.eid === safari && h.kind === 'edit');
  console.log(`History for Safari on Namit's phone: ${flagged.length} edits recorded by the server`, flagged.map((h) => ({ by: h.by === g.people.Jeeju ? 'Jeeju' : 'Namit', changes: Object.keys(h.changes), dev: h.dev })));
  assert.equal(a.count, 17);
  assert.equal(owe, 686000);
  assert.equal(flagged.length, 0); // refused edits never reach history
  console.log(`\nOpen it yourself: http://127.0.0.1:5179/#/join/${g.gid}~${g.key}?as=${g.people.Namit}`);
  console.log('\nStats:', dumps.map((d, i) => `${[namit, deepak][i].name}: ${d.stats.requests} syncs, avg ${d.stats.avg.toFixed(0)} ms, max ${d.stats.max.toFixed(0)} ms, failed ${d.stats.failed}`).join(' | '));
  [namit, deepak].forEach((p) => p.stop());
  void ids;
}

async function stress() {
  const skews = [0, -5 * 60e3, 3 * 60e3, -90e3, 7 * 60e3];
  const names = ['Namit', 'Deepak', 'Himi', 'Priya', 'Rahul'];
  const phones = names.map((n, i) => phone(n, skews[i]));
  await Promise.all(phones.map((p) => p.ready));
  const g = await phones[0].call('create', { name: 'Stress trip', me: 'Namit', others: names.slice(1) });
  await Promise.all(phones.slice(1).map((p) => p.call('join', { gid: g.gid, key: g.key, as: g.people[p.name] })));
  console.log(`5 phones joined ${g.gid} (clocks skewed ${skews.map((s) => s / 60e3 + 'm').join(', ')})`);
  const words = ['dinner', 'cab', 'petrol', 'snacks', 'tickets', 'hotel', 'chai', 'groceries'];
  let ops = 0;
  const t0 = performance.now();
  for (let burst = 0; burst < 10; burst++) {
    // every phone acts at the same instant
    const known = await phones[burst % 5].call('ids');
    await Promise.all(phones.map(async (p, i) => {
      const r = (burst * 7 + i * 3) % 10;
      if (r < 5 || !known.length) return p.call('add', { text: `${100 + ((burst * 37 + i * 91) % 900)} ${words[(burst + i) % words.length]} split with everyone` });
      const target = known[(burst + i) % known.length];
      if (r < 8) return p.call('edit', { id: target, amount: 10000 + ((burst * 13 + i * 17) % 50) * 1000, removeMe: r === 7 });
      return p.call('del', { id: target });
    }));
    ops += 5;
    // two phones edit the SAME expense at the same instant
    if (known.length) await Promise.all([phones[1].call('edit', { id: known[0], amount: 77700 }), phones[3].call('edit', { id: known[0], amount: 88800 })]);
    ops += 2;
    await new Promise((r) => setTimeout(r, 1500)); // stay under 60 writes a minute per group
  }
  console.log(`${ops} concurrent operations in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const dumps = await converge(phones);
  const sum = Object.values(dumps[0].balances).reduce((a, b) => a + b, 0);
  console.log(`All 5 phones identical: ${dumps[0].count} live expenses, total ${rupee(dumps[0].total)}, balances sum to ${sum} (must be 0)`);
  assert.equal(sum, 0);
  console.log('History entries per phone:', dumps.map((d) => d.history.length).join(', '));
  console.log('Stats:', dumps.map((d, i) => `${names[i]} ${d.stats.requests} syncs avg ${d.stats.avg.toFixed(0)}ms max ${d.stats.max.toFixed(0)}ms busy ${d.stats.busy} failed ${d.stats.failed}`).join(' | '));
  phones.forEach((p) => p.stop());
}

async function roles() {
  const namit = phone('Namit'), deepak = phone('Deepak');
  await Promise.all([namit.ready, deepak.ready]);
  const g = await namit.call('create', { name: 'Goa', me: 'Namit', others: ['Deepak'] });
  await deepak.call('join', { gid: g.gid, key: g.key, as: g.people.Deepak });
  const { id: nid } = await namit.call('add', { text: 'hotel 6000 split with everyone' });
  await converge([namit, deepak]);
  console.log('Roles:', { namit: (await namit.call('role')).admin, deepak: (await deepak.call('role')).admin });
  assert.equal((await namit.call('role')).admin, true);
  assert.equal((await deepak.call('role')).admin, false);
  // Member tries to lower the admin's entry and rename the group: server refuses, phone reverts.
  await deepak.call('edit', { id: nid, amount: 100000 });
  await deepak.call('rename', { name: 'Hacked' });
  let d = await converge([namit, deepak]);
  const row = d[0].canon.find((c) => c.startsWith(nid));
  console.log('After member edit attempt:', row.split('|').slice(2, 4).join(' '), '| group name on Deepak:', (await deepak.call('role')).name);
  assert.ok(row.includes('|600000|'));
  assert.equal((await deepak.call('role')).name, 'Goa');
  // Member adds and edits their own entry: allowed.
  const { id: did } = await deepak.call('add', { text: 'cab 500 split with everyone' });
  await deepak.call('edit', { id: did, amount: 70000 });
  d = await converge([namit, deepak]);
  assert.ok(d[0].canon.find((c) => c.startsWith(did)).includes('|70000|'));
  console.log('Member edited own entry: ok');
  // Admin promotes Deepak; now his edit of Namit's entry goes through.
  await namit.call('promote', { name: 'Deepak' });
  await deepak.call('settle');
  console.log('Deepak admin now:', (await deepak.call('role')).admin);
  await deepak.call('edit', { id: nid, amount: 500000 });
  d = await converge([namit, deepak]);
  assert.ok(d[0].canon.find((c) => c.startsWith(nid)).includes('|500000|'));
  console.log('Promoted member edited the admin entry: ok');
  // A new phone claims to be Namit: it waits for approval and cannot touch Namit's entries.
  const fake = phone('Fake');
  await fake.ready;
  await fake.call('join', { gid: g.gid, key: g.key, as: g.people.Namit });
  console.log('Phone claiming Namit:', await fake.call('role').then((r) => ({ admin: r.admin, waitingToBe: r.wants ? 'Namit' : null })));
  await fake.call('edit', { id: nid, amount: 100 });
  d = await converge([namit, deepak, fake]);
  assert.ok(d[0].canon.find((c) => c.startsWith(nid)).includes('|500000|'));
  console.log('Its edit of Namit\'s entry was refused');
  await namit.call('approveAll');
  await fake.call('settle');
  assert.equal((await fake.call('role')).wants, null);
  console.log('Namit approved it; waiting cleared');
  [namit, deepak, fake].forEach((p) => p.stop());
}

await (mode === 'stress' ? stress() : mode === 'roles' ? roles() : nainital());
console.log('\nPASS');
process.exit(0);
