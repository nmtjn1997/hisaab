# Roadmap

Worked top to bottom. Each shipped item moves to Done with the date.

## Next
- Google Sheets export (needs Google sign-in).
- Reminders: nudge people with open balances once a week (local notification).
- End-to-end encryption for live groups (needs a decision: the server could no longer write tamper-proof edit history, since it cannot read changes; would move to signed client-side history).
- Google sign-in (needs an OAuth client ID from Google Cloud): same account restores groups on a new phone.

## Done
- 2026-11-07 Bill photos in live groups: stored with the group on the sync server (chunked, same group key, 1.5 MB and 300 photo caps, images only), uploaded in the background with a retry queue, fetched and cached when a friend opens the expense; going live uploads existing photos.
- 2026-11-07 Spreadsheet export: a group as CSV in Splitwise's layout (per-person nets, Total balance row), opens in Excel and Google Sheets and imports back into Splitwise or Hisaab; formula-looking text neutralised. Deploy script skips an unchanged server and never hangs on a failed push.
- 2026-11-07 Accessibility: all text colours meet 4.5:1 in both themes (faint, and light-mode green, red, amber were below), skip-to-content link, focus moves to the new screen, 40px chips, high-contrast mode outlines. Desktop: left navigation rail, wider content, centred dialogs.
- 2026-11-06 Search everything: expenses, groups and people across all groups; all words must match; amounts (500, 3.8k), people in a bill, categories (diesel finds petrol), bill items; highlighted matches; recent searches; from Home and Groups.
- 2026-11-06 Per-group currency (14 options) and trip budget with dates: progress bar, amount left, per-day allowance and pace colour; synced in live groups; home shows other-currency balances separately so totals never mix currencies.
- 2026-11-06 Live groups hardened with a multi-phone simulator (tests/sim, worker threads running the real app code against the live server): fixed edits lost while a sync was running, edits lost on phones with slow clocks (row fingerprint instead of newest time), split-brain on exact timestamp ties (one total order on server and phones), and idle re-sends eating the write budget. Server-written edit history with device ids, flags for lowered amounts, self-removal, own share lowered, removals and deletes, Undo from history, group History tab, invite prompt after creating a group, 8s live refresh. Nainital trip replayed from 2 phones: Jeeju pays Namit 6,860, identical on both.
- 2026-11-06 Admin monitoring: anonymous usage events (install id, screens with ids stripped, feature counts), crash reports, sync timing per hashed group, D1 storage with 90-day cleanup, Workers Logs on; admin.html dashboard with KPIs, daily users, actions, sync volume and speed, crashes, retention, features, screens, devices, versions, live groups and live logs, behind a bearer token. Settings switch to turn stats off.
- 2026-11-06 Balance card image: 1080x1350 PNG drawn on canvas (title, total, who pays whom with UPI, per-person balances), shared through the phone's share sheet or saved; group header wraps cleanly on narrow phones.
- 2026-11-06 Parser fixes from a real phone test: "shared by / split by / used by" mean who owes (not who paid), "both of us" / "hum dono" / "dono" mean the two people named (never a new person called Both), "paid by us" spreads over members (no Unknown payer). Add screen never defaults to a deleted or archived group.
- 2026-11-06 Motion: native page transitions with a sliding nav pill, tap ripples and spring presses, smart box grows and glows on focus with auto-height, pills pop green or shake red, count-up balances, cascading rows, confetti on add and settle, mic rings and waveform, theme switch circle reveal; all off under reduced motion.
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
