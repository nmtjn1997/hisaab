# Roadmap

Worked top to bottom. Each shipped item moves to Done with the date.

## Next
1. Verify bill scan end to end on the live site with a real receipt photo (Tesseract worker + wasm under the CSP), fix whatever breaks.
2. Hinglish phrasing in the parser: "maine 500 diye", "Rahul ne 300 diye", "sabme baant do", "mere aur Deepak ke beech".
3. "Try with sample data" on the welcome screen so a first-time visitor sees a full group in one tap.
4. Live shared groups: optional Cloudflare Worker + KV so a shared link stays in sync for everyone, with a per-group secret in the URL.
5. Recurring expenses (rent, maid, Netflix) with a monthly auto-add.
6. Android Contact Picker for names and phone numbers when adding people.
7. Shareable balance card image (PNG) for WhatsApp.
8. Per-group currency and a "trip budget" with daily spend.
9. Global search across all groups.
10. Accessibility and Lighthouse pass (contrast in light theme, focus order, labels), desktop two-column layout.

## Done
- 2026-11-06 v1: say-it parser, groups, people, add/edit with equal, exact, %, shares and items, bill OCR, settle up with UPI and WhatsApp reminders, PDF report, share-a-copy links, insights, Splitwise CSV import, backup/restore, offline PWA, GitHub Pages + Cloudflare Pages.
