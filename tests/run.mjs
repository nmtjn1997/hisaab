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
