/**
 * Render every screen to static HTML.
 *
 * This is not a substitute for looking at the product — it cannot catch a
 * layout that reads badly. It does catch the thing that would otherwise reach
 * the browser unnoticed: a screen that throws on its first render, formats a
 * missing date into "Invalid Date", or renders an empty table where content
 * was expected.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureWorkspace } from './fixtures/workspace';
import { Overview } from './screens/Overview';
import { CaptureInbox } from './screens/CaptureInbox';
import { CaseWorkspace } from './screens/CaseWorkspace';
import { Activity } from './screens/Activity';
import { Settings } from './screens/Settings';
import { CommitmentSheet } from './screens/CommitmentSheet';
import { PanelIssue } from './App';
import type { PanelRecord, TrackResult } from './lib/api';

const noop = async () => {};
const props = {
  workspace: fixtureWorkspace,
  onOpenCase: () => {},
  onOpenCommitment: () => {},
  toast: () => {},
  onNavigate: () => {},
};

export function renderAll(): Record<string, string> {
  const issue = fixtureWorkspace.issues[0];
  const commitment =
    fixtureWorkspace.issues.flatMap((i) => i.commitments).find((c) => c.status === 'open' && c.previousOwners.length > 0)
    ?? issue.commitments[0];
  return {
    overview: renderToStaticMarkup(<Overview {...props} />),
    capture: renderToStaticMarkup(<CaptureInbox {...props} onAccept={noop} onReject={noop} />),
    case: renderToStaticMarkup(<CaseWorkspace {...props} issueKey={issue.key} />),
    activity: renderToStaticMarkup(<Activity {...props} />),
    settings: renderToStaticMarkup(<Settings workspace={fixtureWorkspace} onChange={() => {}} toast={() => {}} />),
    drawer: renderToStaticMarkup(
      <CommitmentSheet
        issue={issue}
        commitment={commitment}
        onClose={() => {}}
        onVerify={noop}
        onReassign={noop}
        onDrop={noop}
      />,
    ),
  };
}

/**
 * The issue panel, once per record outcome.
 *
 * The panel is the one screen whose branching is the product: it must never
 * render "no record" for a record that exists, and it must not offer a
 * management action where one could race or be a guess. Rendering each outcome
 * to markup and asserting on the words is the automated floor for that — it
 * cannot click a button, but it does prove each branch renders, and that the
 * Track action appears only where it is safe.
 */
export function renderPanelStates(): Record<string, string> {
  const noTrack = async (): Promise<TrackResult | null> => null;
  const base: PanelRecord = {
    key: 'FS-2',
    status: 'unmanaged',
    state: 'unmanaged',
    rev: 4,
    updatedAt: '2026-11-04T09:00:00.000Z',
    open: 2,
    inTrackedList: false,
    error: null,
  };

  const records: Record<string, PanelRecord | null> = {
    panelManaged: { ...base, status: 'managed', state: 'managed', open: 0 },
    panelUnmanaged: base,
    panelInitializing: { ...base, status: 'initializing', state: 'initializing' },
    panelUnknownState: { ...base, status: 'unknown-state', state: 'suspended-by-hand' },
    panelMissing: { ...base, status: 'missing', state: null, rev: null, open: null, updatedAt: null },
    panelError: { ...base, status: 'error', rev: null, open: null, updatedAt: null, error: 'entity get failed' },
    panelNoAnswer: null,
  };

  const out: Record<string, string> = {};
  for (const [name, record] of Object.entries(records)) {
    out[name] = renderToStaticMarkup(<PanelIssue issueKey="FS-2" record={record} onTrack={noTrack} />);
  }
  return out;
}
