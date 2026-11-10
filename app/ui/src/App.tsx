import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DataMode, Workspace } from './lib/types';
import { api, type PanelRecord, type TrackResult } from './lib/api';
import { Icon, type IconName } from './components/Icons';
import { Button, Empty, Notice, OwnerStamp, Skeleton, Stamp } from './components/primitives';
import { CommandPalette, Sheet, Toasts, type Command, type Toast } from './components/overlays';
import { Overview } from './screens/Overview';
import { CaptureInbox } from './screens/CaptureInbox';
import { CaseWorkspace } from './screens/CaseWorkspace';
import { Activity } from './screens/Activity';
import { Settings } from './screens/Settings';
import { CommitmentSheet } from './screens/CommitmentSheet';

type Route = 'overview' | 'inbox' | 'case' | 'activity' | 'settings';

const NAV: { id: Route; label: string; short: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: 'overview' },
  { id: 'inbox', label: 'Capture inbox', short: 'Capture', icon: 'inbox' },
  { id: 'case', label: 'Cases', short: 'Cases', icon: 'case' },
  { id: 'activity', label: 'Activity & audit', short: 'Activity', icon: 'activity' },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'settings' },
];

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [mode, setMode] = useState<DataMode>('fixture');
  const [route, setRoute] = useState<Route>('overview');
  const [caseKey, setCaseKey] = useState('');
  const [drawer, setDrawer] = useState<{ issueKey: string; code: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  // Set only when Forge opened Relay inside a Jira issue panel. The global page
  // has no issue of its own, so both stay null there.
  const [panelIssue, setPanelIssue] = useState<string | null>(null);
  // The panel's own record, read by key. Deliberately not the tracked list:
  // an unmanaged record is a record, and it is not in that list.
  const [panelRecord, setPanelRecord] = useState<PanelRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.bootstrap().then((res) => {
      if (cancelled) return;
      setWorkspace(res.workspace);
      setMode(res.mode);
      setPanelIssue(res.panelIssue);
      setPanelRecord(res.panelRecord);
      if (res.panelIssue) {
        // Opened inside an issue panel: the route is that issue, and only that issue.
        setCaseKey(res.panelIssue);
        setRoute('case');
      } else {
        // The global page keeps its existing overview landing.
        setCaseKey((k) => k || res.workspace.issues[0]?.key || '');
      }
    }).catch((err: unknown) => {
      if (cancelled) return;
      setBootError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, []);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'default') => {
    const id = Math.random().toString(36).slice(2, 8);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const go = useCallback((r: Route) => { setRoute(r); setMoreOpen(false); }, []);

  useEffect(() => {
    let pendingG = false;
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); return; }
      if (e.key === 'Escape') { setPaletteOpen(false); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'g') {
        pendingG = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { pendingG = false; }, 1200);
        return;
      }
      if (pendingG) {
        const map: Record<string, Route> = { o: 'overview', i: 'inbox', a: 'activity', s: 'settings', c: 'case' };
        if (map[key]) { e.preventDefault(); setRoute(map[key]); }
        pendingG = false;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const replaceIssue = useCallback((issue: Workspace['issues'][number]) => {
    setWorkspace((w) => (w ? { ...w, issues: w.issues.map((i) => (i.key === issue.key ? issue : i)) } : w));
  }, []);

  const openCase = useCallback((key: string) => {
    if (!key) { setRoute('overview'); return; }
    setCaseKey(key);
    setRoute('case');
  }, []);

  const openCommitment = useCallback((issueKey: string, code: string) => setDrawer({ issueKey, code }), []);

  /** Read the issue's real comments and queue anything that reads like a promise. */
  const scanIssue = useCallback(async (key: string) => {
    try {
      const res = await api.scan(key);
      if (res.unavailable) { toast(res.unavailable, 'overdue'); return; }
      replaceIssue(res.issue);
      const created = res.created.length;
      if (created === 0) {
        toast(res.duplicates > 0
          ? `Nothing new — ${res.duplicates} suggestion${res.duplicates > 1 ? 's' : ''} already captured from these comments.`
          : `Read ${res.scanned.comments} comment${res.scanned.comments === 1 ? '' : 's'} on ${key} and found no new promise.`);
      } else {
        toast(`${created} suggestion${created > 1 ? 's' : ''} queued from ${key}. Nothing is a commitment until a person accepts it.`, 'verified');
      }
      if (res.rejected.length) toast(`${res.rejected.length} candidate${res.rejected.length > 1 ? 's were' : ' was'} rejected because the quotation could not be anchored.`, 'overdue');
    } catch (err) {
      toast(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, 'overdue');
    }
  }, [replaceIssue, toast]);

  /** Run the management lifecycle. The server decides the outcome; we report it. */
  const trackIssue = useCallback(async (key: string): Promise<TrackResult | null> => {
    try {
      const { workspace: next, track } = await api.track(key);
      setWorkspace(next);
      toast(
        track.status === 'managed'
          ? `${key} is now managed — ${track.created?.length ?? 0} commitment(s) captured.`
          : track.status === 'already_managed'
            ? `${key} was already managed; its fields were re-verified.`
            : `${key} did not finish (${track.stage ?? 'unknown'}). It stays withheld until track completes.${track.error ? ` ${track.error}` : ''}`,
        track.status === 'failed' ? 'overdue' : 'verified',
      );
      return track;
    } catch (err) {
      toast(`Track failed: ${err instanceof Error ? err.message : String(err)}`, 'overdue');
      return null;
    }
  }, [toast]);

  // `ScreenProps.onTrack` is void-shaped; the panel needs the outcome, so it
  // receives `trackIssue` itself and the screens receive this adapter. One
  // implementation, two shapes.
  const requestTrack = useCallback((key: string) => { void trackIssue(key); }, [trackIssue]);

  /** Offboarding, already confirmed by the caller. */
  const untrackIssue = useCallback(async (key: string, reason: string) => {
    try {
      const { workspace: next, untrack } = await api.untrack(key, { confirm: true, reason });
      setWorkspace(next);
      toast(
        untrack.status === 'unmanaged'
          ? `${key} is unmanaged. The ledger and audit trail are kept.`
          : `Offboarding ${key} did not finish (${untrack.stage ?? 'unknown'}); it stays withheld.`,
        untrack.status === 'unmanaged' ? 'default' : 'overdue',
      );
    } catch (err) {
      toast(`Offboarding failed: ${err instanceof Error ? err.message : String(err)}`, 'overdue');
    }
  }, [toast]);

  const counts = useMemo(() => {
    if (!workspace) return { inbox: 0, blocked: 0 };
    let inbox = 0, blocked = 0;
    for (const i of workspace.issues) {
      if (!i.closure.ready) blocked += 1;
      for (const c of i.commitments) if (c.status === 'proposed') inbox += 1;
    }
    return { inbox, blocked };
  }, [workspace]);

  const commands: Command[] = useMemo(() => {
    if (!workspace) return [];
    const base: Command[] = NAV.map((n) => ({
      id: `go-${n.id}`, label: `Go to ${n.label}`, group: 'Navigate', icon: n.icon,
      hint: n.id === 'overview' ? 'G O' : n.id === 'inbox' ? 'G I' : n.id === 'activity' ? 'G A' : n.id === 'settings' ? 'G S' : 'G C',
      run: () => setRoute(n.id),
    }));
    const cases = workspace.issues.map<Command>((i) => ({
      id: `case-${i.key}`, label: `${i.key} — ${i.summary}`, group: 'Cases', icon: 'case', run: () => openCase(i.key),
    }));
    const commitments = workspace.issues.flatMap((i) => i.commitments.map<Command>((c) => ({
      id: `cm-${c.code}`, label: `${c.code} — ${c.text.slice(0, 68)}`, group: 'Commitments', icon: 'shield',
      run: () => openCommitment(i.key, c.code),
    })));
    return [...base, ...cases, ...commitments];
  }, [workspace, openCase, openCommitment]);

  // Exactly the requested issue, or nothing. Relay never shows another case in
  // place of the one that was asked for.
  const currentIssue = workspace?.issues.find((i) => i.key === caseKey);
  const drawerIssue = workspace?.issues.find((i) => i.key === drawer?.issueKey);
  const drawerCommitment = drawerIssue?.commitments.find((c) => c.code === drawer?.code);

  if (!workspace) return <Boot error={bootError} />;

  const mobilePrimary: Route[] = ['overview', 'inbox', 'case'];
  const moreActive: boolean = route === 'activity' || route === 'settings';

  return (
    <>
      <a className="skip-link" href="#main">Skip to workspace</a>
      <div className="app">
        <header className="masthead">
          <div className="masthead__inner">
            <button className="wordmark" onClick={() => go('overview')} aria-label="Relay — go to overview">
              <span className="wordmark__glyph" aria-hidden="true"><Baton /></span>
              <span className="wordmark__text">Relay</span>
              <span className="wordmark__sub">commitment operations</span>
            </button>

            <button className="workspace-chip" onClick={() => toast('Only one workspace is connected in this release.')}>
              <span className="workspace-chip__mono" aria-hidden="true">{initials(workspace.name)}</span>
              <span className="workspace-chip__meta">
                <span className="workspace-chip__name">{workspace.name}</span>
                <span className="workspace-chip__host">{workspace.site}</span>
              </span>
              <span className="workspace-chip__caret"><Icon name="chevron" size={12} /></span>
            </button>

            <span className="masthead__spacer" />

            <button className="searchbtn" onClick={() => setPaletteOpen(true)} aria-label="Search cases and commitments">
              <Icon name="search" size={14} />
              <span className="searchbtn__label">Search</span>
              <span className="searchbtn__keys"><span className="kbd">Ctrl</span><span className="kbd">K</span></span>
            </button>

            <span className={`mode${mode === 'live' ? ' mode--live' : ''}`} title={mode === 'live' ? 'Reading from Jira through Forge resolvers' : 'No Forge bridge — fixture data'}>
              <Icon name={mode === 'live' ? 'link' : 'alert'} size={11} />
              <span>{mode === 'live' ? 'Live' : 'Fixture'}</span>
            </span>

            <button className="account" onClick={() => go('settings')}>
              <span className="owner__mark" aria-hidden="true">{workspace.viewer.initials}</span>
              <span className="account__text">
                <span className="account__name">{workspace.viewer.name}</span>
                <span className="account__role">{workspace.viewer.role}</span>
              </span>
            </button>
          </div>

          <nav className="tabs" aria-label="Primary">
            <div className="tabs__inner">
              {NAV.map((n) => (
                <button key={n.id} className="tab" aria-current={route === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                  <Icon name={n.icon} size={13} />
                  {n.short}
                  {n.id === 'inbox' && counts.inbox > 0 && <span className="tab__count">{counts.inbox}</span>}
                  {n.id === 'overview' && counts.blocked > 0 && <span className="tab__count">{counts.blocked}</span>}
                </button>
              ))}
            </div>
          </nav>
        </header>

        <main className="main" id="main">
          {route === 'overview' && (
            <Overview workspace={workspace} onOpenCase={openCase} onOpenCommitment={openCommitment} toast={toast} onNavigate={go} />
          )}
          {route === 'inbox' && (
            <CaptureInbox
              workspace={workspace}
              onOpenCase={openCase}
              onOpenCommitment={openCommitment}
              toast={toast}
              onNavigate={go}
              onScan={scanIssue}
              onTrack={requestTrack}
              onUntrack={untrackIssue}
              onAccept={async (k, code, ownerId, dueAt) => {
                replaceIssue(await api.accept(k, code, ownerId, dueAt));
                toast(`${code} accepted. Closure re-evaluated for ${k}.`, 'verified');
              }}
              onReject={async (k, code, reason) => {
                replaceIssue(await api.reject(k, code, reason));
                toast(`${code} rejected — kept in the audit trail.`);
              }}
            />
          )}
          {route === 'case' && (panelIssue && !currentIssue ? (
            <PanelIssue issueKey={panelIssue} record={panelRecord} onTrack={trackIssue} />
          ) : currentIssue ? (
            <CaseWorkspace
              workspace={workspace}
              issueKey={currentIssue.key}
              onOpenCase={openCase}
              onOpenCommitment={openCommitment}
              toast={toast}
              onNavigate={go}
              onScan={scanIssue}
              onTrack={requestTrack}
              onUntrack={untrackIssue}
            />
          ) : (
            <div className="wrap wrap--narrow">
              <div className="page" style={{ marginTop: 26 }}>
                <Empty
                  title="That case is not in the ledger"
                  text={`Relay has no record for ${caseKey || 'that issue'}, so there is nothing to show — and another case is never shown in its place.`}
                  action={<Button onClick={() => go('overview')}>Back to the ledger</Button>}
                />
              </div>
            </div>
          ))}
          {route === 'activity' && <Activity workspace={workspace} onOpenCase={openCase} onOpenCommitment={openCommitment} toast={toast} onNavigate={go} />}
          {route === 'settings' && <Settings workspace={workspace} onChange={setWorkspace} toast={toast} mode={mode} />}
        </main>

        <nav className="tabbar" aria-label="Primary">
          {mobilePrimary.map((id) => {
            const n = NAV.find((x) => x.id === id)!;
            return (
              <button key={id} className="tabbar__item" aria-current={route === id ? 'page' : undefined} onClick={() => go(id)}>
                <Icon name={n.icon} size={18} />
                {n.short}
                {id === 'inbox' && counts.inbox > 0 && <span className="tabbar__dot">{counts.inbox}</span>}
              </button>
            );
          })}
          <button className="tabbar__item" aria-current={moreActive ? 'page' : undefined} onClick={() => setMoreOpen(true)}>
            <Icon name="more" size={18} />
            More
          </button>
        </nav>
      </div>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Workspace">
        <div style={{ display: 'grid', gap: 4 }}>
          {NAV.map((n) => (
            <button
              key={n.id}
              className="menuitem"
              onClick={() => { go(n.id); setMoreOpen(false); }}
              aria-current={route === n.id ? 'page' : undefined}
            >
              <Icon name={n.icon} size={15} />
              <span className="menuitem__label">{n.label}</span>
              {(n.id === 'inbox' ? counts.inbox : n.id === 'overview' ? counts.blocked : 0) > 0 && (
                <span className="menuitem__count">
                  {n.id === 'inbox' ? counts.inbox : counts.blocked}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
          <div className="margin-note__label">Signed in</div>
          <OwnerStamp person={workspace.viewer} />
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{workspace.site}</div>
        </div>
        <div style={{ marginTop: 16 }}>
          <Stamp tone={mode === 'live' ? 'verified' : 'open'}>{mode === 'live' ? 'Live Jira data' : 'Fixture data'}</Stamp>
        </div>
        <div style={{ marginTop: 20 }}>
          <Button variant="primary" icon="search" onClick={() => { setMoreOpen(false); setPaletteOpen(true); }}>Search everything</Button>
        </div>
      </Sheet>

      {drawerIssue && drawerCommitment && (
        <CommitmentSheet
          issue={drawerIssue}
          commitment={drawerCommitment}
          onClose={() => setDrawer(null)}
          onVerify={async (note) => {
            replaceIssue(await api.verify(drawerIssue.key, drawerCommitment.code, note));
            toast(`${drawerCommitment.code} verified. Projection re-derived.`, 'verified');
          }}
          onReassign={async (ownerId, reason) => {
            replaceIssue(await api.reassign(drawerIssue.key, drawerCommitment.code, ownerId, reason));
            toast('Handover recorded.');
          }}
          onDrop={async (reason) => {
            replaceIssue(await api.drop(drawerIssue.key, drawerCommitment.code, reason));
            toast(`${drawerCommitment.code} dropped.`, 'overdue');
          }}
        />
      )}

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </>
  );
}

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

function Baton() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.2" y="5.8" width="11.6" height="2.4" rx="1.2" fill="currentColor" opacity=".95" />
      <path d="M4.4 8.2V3.1M9.6 8.2V3.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

/** How a record's state reads in a sentence, without overclaiming. */
function recordStateWords(record: PanelRecord): string {
  if (record.status === 'unmanaged') return 'Relay holds the record but is not managing the issue';
  if (record.status === 'initializing') return 'a Track or Stop managing started and did not finish';
  if (record.status === 'managed') return 'Relay is managing the issue';
  if (record.state) return `the record carries the state “${record.state}”, which this console does not recognise`;
  return 'the record carries a state this console does not recognise';
}

/**
 * The panel for the issue the app is mounted in.
 *
 * What it renders is decided by the direct record lookup alone (`status`), never
 * by the tracked list. The four outcomes are kept apart on purpose:
 *
 *   * a managed record that did not come back with the workspace — a read
 *     problem, not an absence;
 *   * an existing record Relay is not managing — the case this panel used to
 *     report as "no record";
 *   * genuinely no record;
 *   * the lookup failed — never shown as "no record".
 */
export function PanelIssue({ issueKey, record, onTrack }: {
  issueKey: string;
  record: PanelRecord | null;
  onTrack: (key: string) => Promise<TrackResult | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lookup, setLookup] = useState<PanelRecord | null>(record);
  const [reading, setReading] = useState(false);

  // A later bootstrap (or a retry) replaces the answer; the panel follows it.
  useEffect(() => { setLookup(record); }, [record]);

  const track = async () => {
    setBusy(true);
    setFailure(null);
    const result = await onTrack(issueKey);
    setBusy(false);
    // `null` means the call itself threw; the toast has reported that, and the
    // issue is still untracked either way, so this panel stays where it is.
    if (result && result.status !== 'managed' && result.status !== 'already_managed') {
      setFailure(result.error ?? `${issueKey} did not finish (${result.stage ?? 'unknown'}) and stays withheld.`);
    }
  };

  /** Re-read the record. This changes no management state and writes nothing. */
  const retry = async () => {
    setReading(true);
    try {
      setLookup(await api.issueRecord(issueKey));
    } catch (err) {
      setLookup({
        key: issueKey,
        status: 'error',
        state: null,
        rev: null,
        updatedAt: null,
        open: null,
        inTrackedList: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setReading(false);
    }
  };

  const retryButton = (
    <Button icon="sync" onClick={() => void retry()} disabled={reading}>
      {reading ? 'Reading…' : 'Read it again'}
    </Button>
  );

  const trackButton = (
    <Button variant="primary" icon="sync" onClick={() => void track()} disabled={busy}>
      {busy ? 'Tracking…' : 'Track this issue'}
    </Button>
  );

  const trackFailure = failure && (
    <div style={{ marginTop: 18 }}>
      <Notice tone="danger">{failure}</Notice>
    </div>
  );

  // No answer at all: an older backend, or the bridge returned nothing. That is
  // not evidence of absence, so it is reported as unreadable.
  if (!lookup) {
    return (
      <div className="wrap wrap--narrow">
        <div className="page" style={{ marginTop: 26 }}>
          <Notice tone="warn">
            Relay could not read its record for {issueKey} with this page load. That is not the same as holding
            no record — nothing is claimed either way until the read succeeds.
          </Notice>
          <div style={{ marginTop: 18 }}>{retryButton}</div>
        </div>
      </div>
    );
  }

  // A managed record exists but the workspace did not return it. Keep the
  // existing, honest answer: a read problem, and never another case in its place.
  if (lookup.status === 'managed') {
    return (
      <div className="wrap wrap--narrow">
        <div className="page" style={{ marginTop: 26 }}>
          <Notice tone="warn">
            Relay reports {issueKey} as managed, but no record for it came back with the workspace, so there is
            nothing here that can be shown safely. Reading it again, or reloading the page, is the only remedy
            offered — Relay will not put another case in its place.
          </Notice>
          <div style={{ marginTop: 18 }}>{retryButton}</div>
        </div>
      </div>
    );
  }

  // The lookup failed. Distinct from "no record", and it says so.
  if (lookup.status === 'error') {
    return (
      <div className="wrap wrap--narrow">
        <div className="page" style={{ marginTop: 26 }}>
          <div className="masthead-line">
            <div>
              <div className="masthead-line__date">{issueKey} · issue panel</div>
              <h1 className="page-title">Relay could not read this issue’s record</h1>
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <Notice tone="danger">
              The ledger lookup failed{lookup.error ? ` (${lookup.error})` : ''}. Relay has <strong>not</strong>{' '}
              established that {issueKey} has no record — it could not ask. Reading it again changes nothing:
              no record is created, no state is changed and no commitment is touched.
            </Notice>
          </div>
          <div style={{ marginTop: 18 }}>{retryButton}</div>
        </div>
      </div>
    );
  }

  // A record exists. What the panel may offer depends on what the record says:
  // an `unmanaged` record can be taken over, but an `initializing` one may have
  // an operation in flight, and an unrecognised state must not be guessed at.
  if (lookup.status !== 'missing') {
    const details = [
      lookup.rev !== null ? `revision ${lookup.rev}` : null,
      lookup.open !== null ? `${lookup.open} unresolved commitment${lookup.open === 1 ? '' : 's'} retained` : null,
      lookup.updatedAt ? `last written ${lookup.updatedAt}` : null,
    ].filter(Boolean) as string[];

    const header = (
      <div className="masthead-line">
        <div>
          <div className="masthead-line__date">{issueKey} · issue panel</div>
          <h1 className="page-title">Relay holds a record for this issue</h1>
          <p className="page-lede">
            {issueKey} is in Relay’s ledger: {recordStateWords(lookup)}
            {details.length ? ` (${details.join(', ')})` : ''}. That is not the same as having no record, and it
            is why this panel is not offering to create one. Open cases are listed from the issues Relay manages,
            so an issue Relay is not managing does not appear there — the record itself still exists, and
            Relay will not overwrite it.
          </p>
        </div>
      </div>
    );

    // An operation has started and not finished. Starting another could race it,
    // so the panel offers a re-read and no state change.
    if (lookup.status === 'initializing') {
      return (
        <div className="wrap wrap--narrow">
          <div className="page" style={{ marginTop: 26 }}>
            {header}
            <div style={{ marginTop: 18 }}>
              <Notice tone="warn">
                A management operation for {issueKey} may already be in progress. The record is in the state
                initializing, which is what Relay holds while it sets an issue up or takes it down; closure is
                withheld while it is there. This panel does not offer Track or Stop managing, because a second
                operation started now could race the one that is running. Reading the record again changes
                nothing — it only asks where the operation has got to.
              </Notice>
            </div>
            <div style={{ marginTop: 18 }}>{retryButton}</div>
          </div>
        </div>
      );
    }

    // A state this console does not know. It says so, and changes nothing.
    if (lookup.status === 'unknown-state') {
      return (
        <div className="wrap wrap--narrow">
          <div className="page" style={{ marginTop: 26 }}>
            {header}
            <div style={{ marginTop: 18 }}>
              <Notice tone="danger">
                The record for {issueKey} carries a management state this console does not recognise
                {lookup.state ? ` (“${lookup.state}”)` : ''}. Relay will not guess what it means, and nothing here
                is changed on the strength of a guess: no Track, no Stop managing, and no field or property write.
                Reading the record again changes nothing either. If it persists, the issue’s history is the place
                to find out what wrote it.
              </Notice>
            </div>
            <div style={{ marginTop: 18 }}>{retryButton}</div>
          </div>
        </div>
      );
    }

    // `unmanaged`: Relay holds a record and is not managing the issue. Track is
    // the way in — and it is a state change, not a read, so it says so.
    return (
      <div className="wrap wrap--narrow">
        <div className="page" style={{ marginTop: 26 }}>
          {header}

          {trackFailure}

          <div style={{ marginTop: 22 }}>
            <Empty
              title={busy ? `Tracking ${issueKey}…` : `Track ${issueKey}`}
              text={busy
                ? 'Reading the issue and its comments, then setting it to managed.'
                : `Tracking changes ${issueKey} from unmanaged to managed. Relay keeps the record that already exists, reads the issue’s existing Jira comments once, and may capture sentences from them as proposed commitments. Those proposals are not accepted automatically, and nothing becomes binding just by being captured. This is a management-state change, not a read-only action.`}
              action={trackButton}
            />
          </div>
        </div>
      </div>
    );
  }

  // Genuinely no record.
  return (
    <div className="wrap wrap--narrow">
      <div className="page" style={{ marginTop: 26 }}>
        <div className="masthead-line">
          <div>
            <div className="masthead-line__date">{issueKey} · issue panel</div>
            <h1 className="page-title">This issue is not in the ledger yet</h1>
            <p className="page-lede">
              Relay holds no record for {issueKey}, so it has no commitments, no owner and no closure state to
              show. Tracking reads the issue and its comments once and records it; it never overwrites a record
              that already exists.
            </p>
          </div>
        </div>

        {trackFailure}

        <div style={{ marginTop: 22 }}>
          <Empty
            title={busy ? `Tracking ${issueKey}…` : `Track ${issueKey}`}
            text={busy
              ? 'Reading the issue and its comments.'
              : 'Nothing is claimed about this case until Relay has actually read it. The issue stays withheld until tracking completes.'}
            action={trackButton}
          />
        </div>
      </div>
    </div>
  );
}

function Boot({ error }: { error?: string | null }) {
  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__inner">
          <span className="wordmark">
            <span className="wordmark__glyph" aria-hidden="true"><Baton /></span>
            <span className="wordmark__text">Relay</span>
          </span>
        </div>
        <nav className="tabs"><div className="tabs__inner" /></nav>
      </header>
      <main className="main">
        <div className="wrap wrap--narrow">
          <div className="page">
            <Skeleton w={140} h={9} />
            <div style={{ height: 14 }} />
            <Skeleton w="min(420px, 70%)" h={30} />
            <div style={{ height: 10 }} />
            <Skeleton w="min(520px, 84%)" h={12} />
            <div style={{ height: 30 }} />
            {error ? (
              <Notice tone="danger">
                <div>
                  <div style={{ fontWeight: 500 }}>Relay could not open the ledger</div>
                  <div style={{ marginTop: 6 }}>{error}</div>
                  <div style={{ marginTop: 10 }}>
                    <Button size="sm" onClick={() => window.location.reload()}>Try again</Button>
                  </div>
                </div>
              </Notice>
            ) : (
              <>
                <Skeleton h={64} />
                <div style={{ height: 20 }} />
                <Empty title="Opening the ledger" text="Reading cases, commitments and evidence…" />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}