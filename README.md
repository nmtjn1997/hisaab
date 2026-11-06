# Hisaab

Split bills with friends by typing or speaking a sentence. Free, no sign-up, works offline, data stays on your phone.

**Live:** https://gethisaab.pages.dev/ (also https://nmtjn1997.github.io/hisaab/)

> “Petrol 100, I paid 70 Deepak paid 30, split 50-50”
> “Dinner 1200 paid by Rahul, everyone except Priya”
> “Hotel 6000 split 70-30 between me and Deepak”
> “Rahul owes me 250 for chai”

## What it does

- **Say it or type it.** A rule-based parser (no AI, no server) reads amount, description, who paid (one or many, with amounts), who shares, and how: equal, exact amounts, percentages, ratios like 70-30, "only me", "except Priya", "split 4 ways", "yesterday", "2k".
- **Scan a bill.** On-device OCR (Tesseract.js) reads the items, then "pizza Deepak, beer me and Rahul, rest everyone" assigns them. Tax and service are spread in proportion.
- **Nobody has to join.** Add names, track everything yourself. Add a phone number for WhatsApp reminders and a UPI ID for one-tap payment links.
- **Settle up** with the fewest payments, record payments, undo anything.
- **Share** a WhatsApp summary, a PDF report, or a link that carries a full copy of the group.
- **Insights**: spend by category, month, group, and paid vs share per person.
- **Import from Splitwise** (group CSV export), JSON backup and restore.

## Develop

Plain ES modules, no build step.

```bash
python3 -m http.server 5178    # then open http://127.0.0.1:5178
node tests/run.mjs             # parser, money and receipt tests
```

Bump `VERSION` in `sw.js` on every deploy so phones pick up the new version.
