// Export a group to a new Google Sheet in the person's own Drive.
// Scope is drive.file, so Hisaab can only ever touch the sheets it created, nothing else in Drive.
// No sign-in needed: this asks Google for a one-off permission at the moment of export.
import { CLIENT_ID } from './google-id.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const BOLD = { textFormat: { bold: true } };
const money = (cur) => ({ numberFormat: { type: 'CURRENCY', pattern: `[$${cur} ]#,##0.00` } });

const cell = (v, cur, head) =>
  typeof v === 'number'
    ? { userEnteredValue: { numberValue: v }, userEnteredFormat: money(cur) }
    : { userEnteredValue: { stringValue: String(v) }, ...(head ? { userEnteredFormat: BOLD } : {}) };

/**
 * The create request for one group: the expense table, then who pays whom.
 * `rows` comes from groupRows(); money cells are numbers so the sheet can total them.
 */
export function spreadsheetBody({ title, rows, transfers = [], cur = 'INR' }) {
  const table = rows.map((r, i) => ({ values: r.map((v) => cell(v, cur, i === 0)) }));
  const settle = transfers.length
    ? [{ values: [] }, { values: [cell('Who pays whom', cur, true)] }, ...transfers.map((t) => ({ values: [cell(t.from, cur), cell('pays', cur), cell(t.to, cur), cell(t.amount / 100, cur)] }))]
    : [];
  return {
    properties: { title: String(title || 'Hisaab').slice(0, 100) },
    sheets: [{
      properties: { title: 'Expenses', gridProperties: { frozenRowCount: 1, columnCount: Math.max(6, rows[0]?.length || 6) } },
      data: [{ startRow: 0, startColumn: 0, rowData: [...table, ...settle] }],
    }],
  };
}

// One access token per app load. Google expires it after about an hour; a failed call asks again.
let token = null;
let client = null;

/**
 * Ask Google for permission. Must be called straight from a tap, or the popup is blocked.
 * Resolves with the token, or rejects if the person closes the window.
 */
export function authorize({ force = false } = {}) {
  if (token && !force) return Promise.resolve(token);
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error('Google could not load'));
  return new Promise((ok, fail) => {
    client ||= google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
    client.callback = (r) => (r.access_token ? ok((token = r.access_token)) : fail(new Error(r.error || 'cancelled')));
    client.error_callback = (e) => fail(new Error(e?.type || 'cancelled'));
    client.requestAccessToken({ prompt: '' });
  });
}

/** Create the sheet. Returns its URL. */
export async function createSheet(body, accessToken) {
  const r = await fetch(API, { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401 || r.status === 403) { token = null; throw new Error('permission'); }
  if (!r.ok) throw new Error('failed');
  return (await r.json()).spreadsheetUrl;
}

export const loadGis = () => (window.google?.accounts?.oauth2 ? Promise.resolve() : new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = ok;
  s.onerror = () => fail(new Error('Google could not load'));
  document.head.appendChild(s);
}));
