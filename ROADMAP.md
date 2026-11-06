# Roadmap

Worked top to bottom. Each shipped item moves to Done with the date.

## Next
- Google sign-in (needs an OAuth client ID from Google Cloud): same account restores groups on a new phone.
7. Shareable balance card image (PNG) for WhatsApp.
8. Per-group currency and a "trip budget" with daily spend.
9. Global search across all groups.
10. Accessibility and Lighthouse pass (contrast in light theme, focus order, labels), desktop two-column layout.

## Done
- 2026-11-06 Fix misheard names: "People I heard" chips (Dipak -> Deepak, Hemi -> new person), tap to pick the right person or type the name, or say "rename Hemi to Himi" / "not Hemi, it's Himi" / "Hemi nahi Himi hai". Typing previews live and applies after a 2s pause, on leaving the box, on Enter, or with Apply.
- 2026-11-06 Repeating expenses: Once / Weekly / Monthly, "rent 25000 monthly" or "har mahine" by voice, missed periods added on open with ids that never double-add in live groups, month-end dates kept, Stop button, repeat marker on rows.
- 2026-11-06 Fix by voice or text: "remove Priya", "Priya nahi", "add Amit", "Amit bhi", "actually 1500", "make it 950", "paid by Deepak instead", "actually equally", "call it team lunch", "scratch that". Pills jump to their field. Comments now push in live groups.
- 2026-11-06 Security: escaped category output (XSS via live group), prototype-key ids blocked, categories and split modes allow-listed on server and client, per-group (60/min) and per-IP (300/min) rate limits, "Make a new live link" key rotation, persistent storage request, backup nudge, global error net.
- 2026-11-06 Comments on expenses (synced in live groups) and a "What's new" card listing others' adds, edits, deletes and comments since you last looked.
- 2026-11-06 Live checklist: every field reports said / assumed / missing / does not add up, shown as green, yellow and red pills with one next question, in the mic overlay and the text box. Mic stops faster when everything is said, waits when the amount is missing, and has a who-had-what mode for scanned bills.
- 2026-11-06 Parser: Hindi amounts (do hazaar paanch sau, dedh sau, saade teen hazaar), sound-alike names for speech (Dipak, Himmy, Pria, Nameet).
- 2026-11-06 Bill scan: greyscale + contrast stretch + upscale, PSM 4, digit fixes (O/l/S/B, 420,00), shop name and date, Sub Total as truth (dropped line becomes a placeholder), tax from Grand Total minus Sub Total, reconcile pills.
- 2026-11-06 Live groups: Cloudflare Worker + Durable Object (strongly consistent, server-side merge, SHA-256 of the key only), per-group identity mapping, auto push after edits, 15s pull while open, invite links per person (?as=), Android contact picker.
- 2026-11-06 Feature flags: flags.json defaults plus per-phone toggles in Settings.
- 2026-11-06 Voice keeps listening through pauses: stops ~2.5s after the last word once an amount is heard, waits ~6.5s while it is missing, Done stops at once, live preview while speaking.
- 2026-11-06 Parser: pronouns (her, him, usne), "800 eaten by her", "Priya had 300", "1500 by me", repeated new names, "split into 2 people A and B".
- 2026-11-06 Sample trip: welcome button, settings entry and a shareable #/demo link; paise always print as two digits; Cloudflare _headers for revalidation and security headers.
- 2026-11-06 Hinglish parsing: "maine 500 diye", "Rahul ne bhara", "sabme baant do", "mere aur Deepak ke beech", "Rahul ko 200 diye", "mere liye" (6 tests).
- 2026-11-06 Bill scan verified end to end under the CSP (5 items, ₹2,101, GST and service spread by share); added "Try a sample bill".
- 2026-11-06 v1: say-it parser, groups, people, add/edit with equal, exact, %, shares and items, bill OCR, settle up with UPI and WhatsApp reminders, PDF report, share-a-copy links, insights, Splitwise CSV import, backup/restore, offline PWA, GitHub Pages + Cloudflare Pages.
