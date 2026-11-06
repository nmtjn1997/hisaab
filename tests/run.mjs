// node tests/run.mjs  (no deps)
import assert from 'node:assert/strict';
import { parseExpense } from '../js/parse.js';
import { computeOwed, balances, simplify, allocate, sumVals, fmt } from '../js/money.js';

const people = [
  { id: 'me', name: 'Namit' },
  { id: 'dee', name: 'Deepak' },
  { id: 'rah', name: 'Rahul Sharma' },
  { id: 'pri', name: 'Priya' },
];
const ctx = { people, members: ['me', 'dee', 'rah', 'pri'], me: 'me', now: new Date('2026-11-06T10:00:00').getTime() };
const P = (t, c = ctx) => {
  const d = parseExpense(t, c);
  d.owed = d.amount != null ? computeOwed(d.amount, d.split) : {};
  return d;
};
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };

t('even split default whole group', () => {
  const d = P('Dinner 800');
  assert.equal(d.amount, 80000); assert.equal(d.desc, 'Dinner'); assert.equal(d.category, 'food');
  assert.deepEqual(d.paid, { me: 80000 });
  assert.deepEqual(d.owed, { me: 20000, dee: 20000, rah: 20000, pri: 20000 });
});
t('spoken words + n ways', () => {
  const d = P('dinner eighty dollars split four ways');
  assert.equal(d.amount, 8000);
  assert.equal(Object.keys(d.owed).length, 4);
});
t('two payers, split 50-50', () => {
  const d = P('100 rs product, I paid 70 deepak paid 30, split 50-50');
  assert.deepEqual(d.paid, { me: 7000, dee: 3000 });
  assert.deepEqual(d.owed, { me: 5000, dee: 5000 });
});
t('two payers, owed only me', () => {
  const d = P('product 100, I paid 70 and deepak paid 30, only me');
  assert.deepEqual(d.paid, { me: 7000, dee: 3000 });
  assert.deepEqual(d.owed, { me: 10000 });
});
t('exact owed namit 90 deepak 10', () => {
  const d = P('groceries 100 paid by deepak, namit 90 deepak 10');
  assert.deepEqual(d.paid, { dee: 10000 });
  assert.deepEqual(d.owed, { me: 9000, dee: 1000 });
  assert.equal(d.category, 'groceries');
});
t('percent', () => {
  const d = P('cab 500 namit 90% deepak 10%');
  assert.deepEqual(d.owed, { me: 45000, dee: 5000 });
  assert.equal(d.category, 'travel');
});
t('number before name', () => {
  const d = P('petrol 1000 owns 90 namit 10 deepak');
  assert.deepEqual(d.owed, { me: 90000, dee: 10000 });
});
t('paid by + split between', () => {
  const d = P('Uber 450 paid by Rahul split between me rahul and priya');
  assert.deepEqual(d.paid, { rah: 45000 });
  assert.deepEqual(d.owed, { me: 15000, rah: 15000, pri: 15000 });
});
t('with = include payer', () => {
  const d = P('lunch 600 with deepak');
  assert.deepEqual(d.owed, { me: 30000, dee: 30000 });
});
t('for X only X owes', () => {
  const d = P('I paid 300 for deepak');
  assert.deepEqual(d.paid, { me: 30000 });
  assert.deepEqual(d.owed, { dee: 30000 });
});
t('for pizza is description', () => {
  const d = P('paid 500 for pizza');
  assert.equal(d.desc, 'Pizza'); assert.equal(d.amount, 50000);
  assert.equal(d.newNames.length, 0);
});
t('excluding', () => {
  const d = P('movie tickets 900 everyone except priya');
  assert.deepEqual(d.owed, { me: 30000, dee: 30000, rah: 30000 });
  assert.equal(d.category, 'fun');
});
t('owes me', () => {
  const d = P('Rahul owes me 500 for lunch');
  assert.deepEqual(d.paid, { me: 50000 });
  assert.deepEqual(d.owed, { rah: 50000 });
  assert.equal(d.desc, 'Lunch');
});
t('I owe', () => {
  const d = P('I owe deepak 200');
  assert.deepEqual(d.paid, { dee: 20000 });
  assert.deepEqual(d.owed, { me: 20000 });
});
t('new person by name', () => {
  const d = P('chai 120 paid by Amit split with me');
  assert.equal(d.newNames[0].name, 'Amit');
  assert.deepEqual(d.paid, { 'new:amit': 12000 });
  assert.deepEqual(d.owed, { 'new:amit': 6000, me: 6000 });
});
t('k suffix, yesterday', () => {
  const d = P('rent 25k yesterday');
  assert.equal(d.amount, 2500000);
  assert.equal(new Date(d.date).getDate(), 5);
  assert.equal(d.category, 'home');
});
t('fuzzy name', () => {
  const d = P('snacks 200 paid by deepk');
  assert.deepEqual(d.paid, { dee: 20000 });
});
t('70-30 ratio among two named', () => {
  const d = P('hotel 3000 split 70-30 between me and deepak');
  assert.deepEqual(d.owed, { me: 210000, dee: 90000 });
});
t('rupee sign and commas', () => {
  const d = P('₹1,250 flight');
  assert.equal(d.amount, 125000); assert.equal(d.desc, 'Flight');
});
t('me and deepak only', () => {
  const d = P('breakfast 300 me and deepak');
  assert.deepEqual(d.owed, { me: 15000, dee: 15000 });
});

// money
t('allocate sums exactly', () => {
  const a = allocate(10000, { a: 1, b: 1, c: 1 });
  assert.equal(sumVals(a), 10000);
});
t('simplify settles everything', () => {
  const ex = [
    { paid: { a: 900 }, owed: { a: 300, b: 300, c: 300 } },
    { paid: { b: 600 }, owed: { a: 200, b: 200, c: 200 } },
  ];
  const b = balances(ex);
  const tr = simplify(b);
  const after = { ...b };
  for (const x of tr) { after[x.from] += x.amount; after[x.to] -= x.amount; }
  assert.ok(Object.values(after).every((v) => v === 0));
  assert.ok(tr.length <= 2);
});

process.on("exit", () => console.log(`${n} passed`));

import { assignItems } from '../js/parse.js';
import { parseReceipt } from '../js/receipt.js';
t('assign items by text', () => {
  const items = [{ name: 'Paneer Pizza', amount: 40000, who: ['me', 'dee', 'rah'] }, { name: 'Beer', amount: 30000, who: ['me', 'dee', 'rah'] }, { name: 'Coke', amount: 6000, who: ['me', 'dee', 'rah'] }];
  const r = assignItems('Deepak had the pizza, beer me and rahul, rest everyone', items, ctx);
  assert.deepEqual(r[0].who, ['dee']);
  assert.deepEqual(r[1].who, ['me', 'rah']);
  assert.deepEqual(r[2].who, ['me', 'dee', 'rah', 'pri']);
});
t('receipt text', () => {
  const r = parseReceipt(`CAFE MOCHA\nGSTIN 07ABC\n1 Paneer Tikka 2 x 180 360.00\nVeg Biryani 250.00\nCold Coffee 2 @ 120 240\nSub Total 850.00\nCGST 2.5% 21.25\nSGST 2.5% 21.25\nGrand Total 892.50\nThank you visit again`);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].amount, 36000);
  assert.equal(r.total, 89250);
  assert.equal(r.extras.length, 2);
});
console.log('receipt+items ok');

t('hinglish: maine diye', () => {
  const d = P('maine 500 diye pizza ke liye');
  assert.deepEqual(d.paid, { me: 50000 }); assert.equal(d.desc, 'Pizza');
  assert.equal(Object.keys(d.owed).length, 4);
});
t('hinglish: X ne diye', () => {
  const d = P('cab 300 Rahul ne diye');
  assert.deepEqual(d.paid, { rah: 30000 }); assert.equal(d.desc, 'Cab');
});
t('hinglish: sabme baant do', () => {
  const d = P('chai 200 Deepak ne bhara, sabme baant do');
  assert.deepEqual(d.paid, { dee: 20000 });
  assert.equal(Object.keys(d.owed).length, 4);
});
t('hinglish: mere aur Deepak ke beech', () => {
  const d = P('dinner 800 mere aur Deepak ke beech');
  assert.deepEqual(d.owed, { me: 40000, dee: 40000 });
});
t('hinglish: X ko diye is a loan', () => {
  const d = P('maine Rahul ko 200 diye');
  assert.deepEqual(d.paid, { me: 20000 });
  assert.deepEqual(d.owed, { rah: 20000 });
});
t('hinglish: mere liye', () => {
  const d = P('Deepak ne mere liye 300 diye');
  assert.deepEqual(d.paid, { dee: 30000 });
  assert.deepEqual(d.owed, { me: 30000 });
});

t('money format', () => {
  assert.equal(fmt(830250), '₹8,302.50');
  assert.equal(fmt(120000), '₹1,200');
  assert.equal(fmt(-5), '-₹0.05');
  assert.equal(fmt(10000000), '₹1,00,000');
});

t('user case: multi payer, her, eaten by, new name', () => {
  const c = { people: [{ id: 'me', name: 'Namit' }], members: ['me'], me: 'me', now: ctx.now };
  const d = parseExpense('2000 bill, splitted into two people namit and himi and paid by multiple people 1500 by me and 500 by her and will also like 800 eaten by her 1200 eaten by me, himi is name', c);
  assert.equal(d.amount, 200000);
  assert.equal(d.desc, 'Bill');
  assert.deepEqual(d.newNames, [{ id: 'new:himi', name: 'Himi' }]);
  assert.deepEqual(d.paid, { me: 150000, 'new:himi': 50000 });
  assert.deepEqual(computeOwed(d.amount, d.split), { me: 120000, 'new:himi': 80000 });
});
t('person had amount', () => {
  const d = P('pizza 900 paid by Rahul, Priya had 300, rest me and deepak');
  assert.equal(d.owed.pri, 30000);
  assert.equal(d.owed.me + d.owed.dee, 60000);
});
t('usne pronoun', () => {
  const d = P('dinner 1000 Deepak ke saath, usne 600 diye maine 400 diye');
  assert.deepEqual(d.paid, { dee: 60000, me: 40000 });
});

import { mergeGroup, cleanGroup } from '../js/merge.js';
t('merge: newer edit wins, deletes win, members union', () => {
  const a = { name: 'Trip', nameAt: 1, members: ['x', 'y'], people: {}, expenses: { e1: { id: 'e1', desc: 'old', updatedAt: 1 }, e2: { id: 'e2', desc: 'keep', updatedAt: 5 } } };
  const b = { name: 'Goa', nameAt: 2, members: ['y', 'z'], people: {}, expenses: { e1: { id: 'e1', desc: 'new', updatedAt: 3 }, e2: { id: 'e2', deleted: true, desc: 'keep', updatedAt: 4 } } };
  const m = mergeGroup(a, b);
  assert.equal(m.name, 'Goa');
  assert.deepEqual(m.members, ['x', 'y', 'z']);
  assert.equal(m.expenses.e1.desc, 'new');
  assert.equal(m.expenses.e2.deleted, undefined);
  assert.deepEqual(mergeGroup(b, a).expenses.e1.desc, 'new');
});
t('clean: drops bad ids, trims strings, ints only', () => {
  const c = cleanGroup({ name: 'x'.repeat(99), members: ['ok', 'bad id!'], people: { '<x>': { name: 'h' } }, expenses: { e1: { id: 'e1', desc: '<b>hi</b>', amount: '12.7', paid: { a: 5, 'b c': 3 }, owed: {} } } });
  assert.equal(c.name.length, 50);
  assert.deepEqual(c.members, ['ok']);
  assert.deepEqual(c.people, {});
  assert.equal(c.expenses.e1.amount, 13);
  assert.deepEqual(c.expenses.e1.paid, { a: 5 });
});

t('unknown first name in a list after split into', () => {
  const c = { people: [{ id: 'me', name: 'You' }], members: ['me'], me: 'me', now: ctx.now };
  const d = parseExpense('2000 bill, splitted into two people namit and himi', c);
  assert.equal(d.desc, 'Bill');
  assert.deepEqual(d.newNames.map((n) => n.name), ['Namit', 'Himi']);
});

import { hindiNumbers, phon } from '../js/parse.js';
t('hindi amounts', () => {
  assert.equal(P('do hazaar paanch sau ka khana').amount, 250000);
  assert.equal(P('dedh sau chai').amount, 15000);
  assert.equal(P('saade teen hazaar hotel').amount, 350000);
  assert.equal(P('2 hazaar rent').amount, 200000);
  assert.equal(P('Rahul ne 500 diye, sabme baant do').amount, 50000); // "do" alone is a verb
});
t('sound-alike names', () => {
  assert.equal(phon('Deepak'), phon('Dipak'));
  assert.equal(phon('Himi'), phon('Himmy'));
  assert.equal(phon('Himi'), phon('Hemi'));
  assert.equal(phon('Namit'), phon('Nameet'));
  assert.deepEqual(P('snacks 200 paid by Dipak').paid, { dee: 20000 });
  assert.deepEqual(P('cab 300 paid by Pria').paid, { pri: 30000 });
});
t('slots: defaults are assumed, said things are ok', () => {
  const a = P('Dinner 800');
  assert.deepEqual(a.slots, { what: 'ok', amount: 'ok', paid: 'assumed', who: 'assumed', split: 'assumed', when: null });
  const b = P('Dinner 800 paid by Rahul split equally with Priya yesterday');
  assert.deepEqual(b.slots, { what: 'ok', amount: 'ok', paid: 'ok', who: 'ok', split: 'ok', when: 'ok' });
  assert.equal(P('paid by Rahul').slots.amount, 'missing');
  assert.equal(P('dinner 1000, I paid 700').slots.paid, 'bad');
  assert.equal(P('cab 500 namit 60% deepak 10%').slots.split, 'bad');
  assert.equal(P('Rahul owes me 200').slots.paid, 'ok');
});

import { fixDigits, findDate } from '../js/receipt.js';
t('ocr digit fixes and comma decimals', () => {
  const r = parseReceipt('Masala Dosa 12O.00\nFilter Coffee 6S,00\nTotal 185.00');
  assert.deepEqual(r.items.map((i) => i.amount), [12000, 6500]);
  assert.equal(r.diff, 0);
  assert.equal(fixDigits('l2O'), '120');
});
t('receipt reconcile, merchant, date', () => {
  const r = parseReceipt('CAFE MONSOON\nBill No 12  06/11/2026\nPizza 420.00\nFries 180.00\nCGST 15.00\nGrand Total 700.00');
  assert.equal(r.merchant, 'CAFE MONSOON');
  assert.equal(new Date(r.date).getDate(), 6);
  assert.equal(r.diff, 8500); // 700 - 600 - 15: a line was missed
  assert.equal(findDate('date 31-12-2099'), null);
});

t('receipt: garbled tax line between subtotal and total still counts', () => {
  const r = parseReceipt('Paneer Pizza 420.00\nBeer Pitcher 650.00\nSub Total 1070.00\n[Gol y2e 56 47.75\nService Charge 95.50\nGrand Total 1213.25');
  assert.equal(r.items.length, 2);
  assert.equal(r.extraSum, 14325);
  assert.equal(r.diff, 0);
});

t('receipt: dropped item line becomes a placeholder, tax from totals', () => {
  const r = parseReceipt('CAFE MONSOON\nPaneer Pizza 420.00\nBeer Pitcher 650.00\nSub Total 1250.00\nCGST 2.5% A 7.75\nService Charge 95.50\nGrand Total 1400.00');
  assert.equal(r.unread, 18000);
  assert.equal(r.items.at(-1).unread, true);
  assert.equal(r.extraSum, 15000);
  assert.equal(r.items.reduce((a, i) => a + i.amount, 0) + r.extraSum, r.total);
});

t('merge: comments union, newer wins, junk dropped', () => {
  const a = cleanGroup({ comments: { c1: { eid: 'e1', by: 'x', text: 'hi', createdAt: 1, updatedAt: 1 } } });
  const b = cleanGroup({ comments: { c2: { eid: 'e1', by: 'y', text: 'yo', createdAt: 2, updatedAt: 2 }, c1: { eid: 'e1', by: 'x', text: 'hi', deleted: true, createdAt: 1, updatedAt: 3 }, 'bad id': { eid: 'e1', by: 'y', text: 'x' } } });
  const m = mergeGroup(a, b);
  assert.deepEqual(Object.keys(m.comments).sort(), ['c1', 'c2']);
  assert.equal(m.comments.c1.deleted, true);
});

t('corrections: remove / nahi / hatao', () => {
  assert.deepEqual(Object.keys(P('Dinner 800 split with everyone, remove Priya').owed), ['me', 'dee', 'rah']);
  assert.deepEqual(Object.keys(P('cab 300, Priya nahi').owed), ['me', 'dee', 'rah']);
  assert.deepEqual(Object.keys(P('cab 300 split with Rahul and Deepak, Deepak ko hatao').owed), ['rah', 'me']);
});
t('corrections: add / bhi, new names too', () => {
  const d = P('lunch 600 with Deepak, add Amit');
  assert.deepEqual(Object.keys(d.owed), ['dee', 'me', 'new:amit']);
  assert.equal(Object.keys(P('chai 100, Amit bhi').owed).length, 5);
});
t('corrections: amount and payer', () => {
  assert.equal(P('Dinner 800 paid by Rahul, actually 1200').amount, 120000);
  assert.deepEqual(P('Dinner 800 paid by Rahul, actually 1200').paid, { rah: 120000 });
  assert.deepEqual(P('Dinner 800 paid by Rahul, no, paid by Deepak').paid, { dee: 80000 });
  assert.deepEqual(P('Dinner 800 paid by Rahul, paid by Deepak instead').paid, { dee: 80000 });
  assert.equal(P('Dinner 800 make it 950').amount, 95000);
});
t('corrections: split mode and rename', () => {
  const d = P('hotel 3000 between me and Deepak 70-30, actually equally');
  assert.deepEqual(d.owed, { me: 150000, dee: 150000 });
  assert.equal(P('800 food, call it team lunch').desc, 'Team lunch');
});

t('clean: blocks prototype keys and unknown categories', () => {
  const c = cleanGroup(JSON.parse('{"members":["__proto__","ok"],"people":{"__proto__":{"name":"x"}},"expenses":{"e1":{"id":"e1","category":"<img src onerror=x>","paid":{"__proto__":1,"a":2},"split":{"mode":"<b>","parts":{}}}}}'));
  assert.deepEqual(c.members, ['ok']);
  assert.deepEqual(Object.keys(c.people), []);
  assert.equal(c.expenses.e1.category, 'general');
  assert.equal(c.expenses.e1.split.mode, 'exact');
  assert.deepEqual(c.expenses.e1.paid, { a: 2 });
  assert.equal({}.polluted, undefined);
});
