// Feature switches. Defaults come from /flags.json (edit and deploy to change for everyone);
// each phone can override any of them in Settings > Features.
export const FLAGS = {
  voice: ['Voice input', 'Mic buttons to speak an expense'],
  voiceQuickStop: ['Quick voice stop', 'Stop listening 2.5s after you finish instead of 3.5s'],
  scan: ['Bill scan', 'Read items from a photo of the bill'],
  liveGroups: ['Live groups', 'Share a link so friends add expenses and stay in sync'],
  upi: ['UPI pay buttons', 'One tap UPI payment links when settling'],
  whatsapp: ['WhatsApp reminders', 'Remind and share buttons'],
  insights: ['Insights', 'Spend charts and the Insights tab'],
  hints: ['Example phrases', 'Tappable examples under the quick add bar'],
  sampleData: ['Sample trip', 'Offer a sample group to explore'],
  splitwiseImport: ['Splitwise import', 'Import a Splitwise CSV export'],
  sheetsExport: ['Google Sheets export', 'Send a group straight to a new sheet in your Google Drive'],
  haptics: ['Vibration', 'Small vibration on taps'],
  telemetry: ['Share anonymous usage stats', 'Screens opened, features used and crash reports. Never names, amounts or bills'],
};
let defaults = Object.fromEntries(Object.keys(FLAGS).map((k) => [k, true]));
export async function loadFlagDefaults() {
  try {
    const r = await fetch('flags.json', { cache: 'no-cache' });
    if (r.ok) defaults = { ...defaults, ...(await r.json()) };
  } catch {}
}
export const flagDefault = (k) => defaults[k] !== false;
