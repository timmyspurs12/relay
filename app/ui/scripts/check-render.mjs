/**
 * Render every screen to static markup and assert that expected content is
 * present and that no known-broken values leaked into the output.
 *
 * This is not a substitute for looking at the product. It is the automated
 * floor: it catches a screen that throws, an "Invalid Date", a missing panel or
 * an empty table before anyone opens a browser.
 */
import { renderAll, renderPanelStates } from '../.prerender/prerender.js';

const out = renderAll();

const expected = {
  overview: ['What needs a decision today', 'The ledger', 'REP-1042', 'cases cannot close'],
  capture: ['lifted verbatim', 'What Relay proposes', 'Accept commitment', 'REP-1039'],
  case: ['Closure readiness', 'Commitments on this case', 'What a customer sees', 'REP-1042'],
  activity: ['Every change to a promise, in order', 'REP-1042'],
  settings: ['How Relay behaves on this site', 'Jira site', 'Enforcement'],
  drawer: ['Handovers', 'Verified by', 'Confidence'],
};

const forbidden = [/Invalid Date/, />undefined</, /\bNaN\b/, /\[object Object\]/];

let failures = 0;
for (const [name, needles] of Object.entries(expected)) {
  const html = out[name] ?? '';
  const missing = needles.filter((n) => !html.toLowerCase().includes(n.toLowerCase()));
  const bad = forbidden.filter((re) => re.test(html)).map(String);
  const ok = missing.length === 0 && bad.length === 0 && html.length > 800;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${String(html.length).padStart(6)} chars`);
  if (missing.length) console.log(`     missing: ${missing.join(', ')}`);
  if (bad.length) console.log(`     forbidden values: ${bad.join(', ')}`);
  if (!ok) failures += 1;
}

/*
 * The issue panel, one render per record outcome.
 *
 * `mustNot` is the load-bearing half: the Track action may appear only where
 * taking it over is a state change the reader has been told about. For a record
 * that is mid-operation, unrecognised, unreadable or already managed, offering
 * Track would be an invitation to race or to guess.
 */
const panel = renderPanelStates();

const panelExpected = {
  panelManaged: {
    must: ['came back with the workspace', 'read it again'],
    mustNot: ['track this issue'],
  },
  panelUnmanaged: {
    must: ['relay holds a record for this issue', 'changes fs-2 from unmanaged to managed',
      'existing jira comments', 'as proposed commitments', 'management-state change', 'not a read-only action',
      'track this issue'],
    mustNot: ['not in the ledger yet'],
  },
  panelInitializing: {
    must: ['relay holds a record for this issue', 'may already be in progress', 'read it again'],
    mustNot: ['track this issue', 'not in the ledger yet'],
  },
  panelUnknownState: {
    must: ['relay holds a record for this issue', 'does not recognise', 'read it again'],
    mustNot: ['track this issue', 'not in the ledger yet'],
  },
  panelMissing: {
    must: ['not in the ledger yet', 'track this issue'],
    mustNot: [],
  },
  panelError: {
    must: ['could not read', 'read it again'],
    mustNot: ['track this issue', 'not in the ledger yet'],
  },
  panelNoAnswer: {
    must: ['could not read', 'read it again'],
    mustNot: ['track this issue', 'not in the ledger yet'],
  },
};

for (const [name, { must, mustNot }] of Object.entries(panelExpected)) {
  const html = (panel[name] ?? '').toLowerCase();
  const missing = must.filter((n) => !html.includes(n.toLowerCase()));
  const present = mustNot.filter((n) => html.includes(n.toLowerCase()));
  const bad = forbidden.filter((re) => re.test(panel[name] ?? '')).map(String);
  const ok = html.length > 200 && missing.length === 0 && present.length === 0 && bad.length === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${String(html.length).padStart(5)} chars`);
  if (missing.length) console.log(`     missing: ${missing.join(', ')}`);
  if (present.length) console.log(`     must not appear: ${present.join(', ')}`);
  if (bad.length) console.log(`     forbidden values: ${bad.join(', ')}`);
  if (!ok) failures += 1;
}

if (failures) {
  console.error(`\n${failures} screen(s) failed the render check.`);
  process.exit(1);
}
console.log('\nAll screens and panel states rendered with expected content.');
