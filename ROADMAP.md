# Roadmap

Worked top to bottom. Each shipped item moves to Done with the date.

## Next
- Google sign-in (needs an OAuth client ID from Google Cloud): same account restores groups on a new phone.
- Per-expense comments and an activity feed for live groups.
5. Recurring expenses (rent, maid, Netflix) with a monthly auto-add.
7. Shareable balance card image (PNG) for WhatsApp.
8. Per-group currency and a "trip budget" with daily spend.
9. Global search across all groups.
10. Accessibility and Lighthouse pass (contrast in light theme, focus order, labels), desktop two-column layout.

## Done
- 2026-11-06 Live groups: Cloudflare Worker + Durable Object (strongly consistent, server-side merge, SHA-256 of the key only), per-group identity mapping, auto push after edits, 15s pull while open, invite links per person (?as=), Android contact picker.
- 2026-11-06 Feature flags: flags.json defaults plus per-phone toggles in Settings.
- 2026-11-06 Voice keeps listening through pauses: stops ~2.5s after the last word once an amount is heard, waits ~6.5s while it is missing, Done stops at once, live preview while speaking.
- 2026-11-06 Parser: pronouns (her, him, usne), "800 eaten by her", "Priya had 300", "1500 by me", repeated new names, "split into 2 people A and B".
- 2026-11-06 Sample trip: welcome button, settings entry and a shareable #/demo link; paise always print as two digits; Cloudflare _headers for revalidation and security headers.
- 2026-11-06 Hinglish parsing: "maine 500 diye", "Rahul ne bhara", "sabme baant do", "mere aur Deepak ke beech", "Rahul ko 200 diye", "mere liye" (6 tests).
- 2026-11-06 Bill scan verified end to end under the CSP (5 items, ₹2,101, GST and service spread by share); added "Try a sample bill".
- 2026-11-06 v1: say-it parser, groups, people, add/edit with equal, exact, %, shares and items, bill OCR, settle up with UPI and WhatsApp reminders, PDF report, share-a-copy links, insights, Splitwise CSV import, backup/restore, offline PWA, GitHub Pages + Cloudflare Pages.
