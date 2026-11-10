/**
 * The issue panel's record discovery.
 *
 * The bug these tests exist for: Relay held a record for an issue and still
 * told the reader "Relay holds no record", because the panel asked the tracked
 * list instead of asking the store. The tracked list is a curated *selection*
 * of managed issues; a backfilled or trigger-created `unmanaged` record is not
 * on it, and never will be.
 *
 * So every test here asserts on the distinction the bug collapsed:
 *
 *   * a record that exists is found whether or not it is listed;
 *   * absence and an unreadable store are different answers;
 *   * asking the question changes nothing.
 *
 * These run the real handlers against the in-memory fake. That proves the
 * wiring, the branching and the absence of writes. It proves nothing about how
 * a live Jira or a live entity store behaves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../src/handlers.js';
import { emptyLedger } from '../src/ledger.js';
import {
  createFakeJira, createMemoryRecords, createMemoryStorage, MODULE_TYPE_PREFIX, rawIssue, rawComment,
} from './support/fake-forge.js';

const NOW = new Date('2026-11-04T09:00:00.000Z');
const clock = () => NOW;
const ctx = {
  accountId: 'acc-maya',
  account: { displayName: 'Maya Okafor' },
  siteUrl: 'https://onepes930.atlassian.net',
  localId: `${MODULE_TYPE_PREFIX}/relay-workspace`,
  extension: { issue: { key: 'FS-101' } },
};

function build() {
  const storage = createMemoryStorage();
  const records = createMemoryRecords();
  const fake = createFakeJira({
    issue: rawIssue(),
    comments: [rawComment()],
    people: [{ id: 'acc-maya', name: 'Maya Okafor' }],
  });
  const handlers = createHandlers({ jira: fake.jira, storage, records, now: clock, log: () => {} });
  return { handlers, fake, storage, records };
}

/** What the panel actually renders from, in one call. */
const panel = (res) => res.panelRecord;

/** Everything the lookup must leave untouched. */
function snapshot({ records, fake }) {
  return {
    commits: records.commits.length,
    raw: records.raw('FS-101'),
    projectionWrites: fake.state.projectionWrites,
    countFieldWrites: fake.fields.count.writes.length,
    stateFieldWrites: fake.fields.state.writes.length,
    storageWrites: 0,
  };
}

test('1. an existing managed record is discovered by the panel', async () => {
  const { handlers } = build();
  await handlers['relay.workspace.init']({ payload: { projectKey: 'FS' }, context: ctx });
  await handlers['relay.workspace.track']({ payload: { key: 'FS-101' }, context: ctx });

  const res = await handlers.bootstrap({ context: ctx });
  assert.equal(panel(res).status, 'managed');
  assert.equal(panel(res).state, 'managed');
  assert.equal(panel(res).key, 'FS-101');
  assert.equal(panel(res).inTrackedList, true, 'a tracked issue is also listed');
  assert.equal(panel(res).error, null);
});

test('2. an existing unmanaged record is discovered even when it is not in the tracked list', async () => {
  const { handlers, storage } = build();
  // Backfill: records the issue as `unmanaged` and, by design, does not add it
  // to the tracked list. This is FS-2's shape.
  const init = await handlers['relay.workspace.init']({ payload: { projectKey: 'FS' }, context: ctx });
  assert.deepEqual(init.initialised, ['FS-101']);

  const trackedList = await storage.get('relay:tracked');
  assert.ok(!trackedList || !trackedList.some((t) => t.key === 'FS-101'), 'the record exists and is deliberately unlisted');

  const res = await handlers.bootstrap({ context: ctx });
  assert.equal(panel(res).status, 'unmanaged',                                          // the record
    'the panel must report the record it holds, not the list it is missing from');
  assert.equal(panel(res).state, 'unmanaged');
  assert.equal(panel(res).inTrackedList, false, 'and it says plainly that the issue is not listed');
  assert.equal(res.workspace.issues.length, 0, 'the workspace is still built from the tracked list');
  assert.equal(res.panelTracked, false, 'list membership is still false — existence is a different question');

  // The standalone lookup answers the same way, with no workspace around it.
  const direct = await handlers['relay.issue.record']({ payload: { key: 'FS-101' } });
  assert.equal(direct.status, 'unmanaged');
  assert.equal(direct.rev, panel(res).rev, 'the same record, not a copy of it');
});

test('3. an issue with no record is reported as genuinely missing', async () => {
  const { handlers } = build();
  const res = await handlers.bootstrap({ context: ctx });

  assert.equal(panel(res).status, 'missing');
  assert.equal(panel(res).state, null);
  assert.equal(panel(res).rev, null);
  assert.equal(panel(res).error, null, 'a missing record is an answer, not a failure');

  const direct = await handlers['relay.issue.record']({ payload: { key: 'FS-101' } });
  assert.equal(direct.status, 'missing');
});

test('4. a failed storage read is never reported as a missing record', async () => {
  const { handlers, records } = build();
  await handlers['relay.workspace.init']({ payload: { projectKey: 'FS' }, context: ctx });

  // The record is there; the store cannot answer for it.
  records.read = async () => { throw new Error('entity get failed (simulated)'); };

  const res = await handlers.bootstrap({ context: ctx });
  assert.equal(panel(res).status, 'error', 'not "missing"');
  assert.notEqual(panel(res).status, 'missing');
  assert.match(panel(res).error ?? '', /entity get failed/);
  assert.equal(panel(res).rev, null);

  const direct = await handlers['relay.issue.record']({ payload: { key: 'FS-101' } });
  assert.equal(direct.status, 'error');
});

test('4b. a missing issue key is an error, not an absence', async () => {
  const { handlers } = build();
  const direct = await handlers['relay.issue.record']({ payload: {} });
  assert.equal(direct.status, 'error');
  assert.equal(direct.error, 'issue_key_required');
});

test('4c. an `initializing` record is a record: it is not reported as missing', async () => {
  const { handlers, records } = build();
  await records.create('FS-101', emptyLedger('FS-101', NOW.toISOString(), 'initializing'));

  const res = await handlers.bootstrap({ context: ctx });
  assert.equal(panel(res).status, 'initializing');
  assert.notEqual(panel(res).status, 'missing');
  assert.equal(panel(res).state, 'initializing');
});

test('5. the lookup mutates nothing: no ledger commit, no Jira field or property write', async () => {
  const { handlers, fake, records, storage } = build();
  await handlers['relay.workspace.init']({ payload: { projectKey: 'FS' }, context: ctx });

  const before = snapshot({ records, fake });
  const rawBefore = JSON.stringify(before.raw);
  const storageSetsBefore = storage.calls.filter((c) => c[0] === 'set').length;

  await handlers['relay.issue.record']({ payload: { key: 'FS-101' } });
  await handlers['relay.issue.record']({ payload: { key: 'FS-101' } });

  const after = snapshot({ records, fake });
  assert.equal(after.commits, before.commits, 'no create and no revision bump');
  assert.equal(JSON.stringify(after.raw), rawBefore, 'the stored record is byte-identical');
  assert.equal(after.projectionWrites, before.projectionWrites, 'no issue property write');
  assert.equal(after.countFieldWrites, before.countFieldWrites, 'no closure-count field write');
  assert.equal(after.stateFieldWrites, before.stateFieldWrites, 'no management-state field write');
  assert.equal(storage.calls.filter((c) => c[0] === 'set').length, storageSetsBefore, 'no key/value write at all');

  // And bootstrap — which the panel actually calls — writes no Jira field and
  // commits nothing to the ledger either.
  const ledgerBefore = JSON.stringify(records.raw('FS-101'));
  const commitsBefore = records.commits.length;
  const fieldsBefore = fake.fields.count.writes.length + fake.fields.state.writes.length;
  await handlers.bootstrap({ context: ctx });
  assert.equal(records.commits.length, commitsBefore);
  assert.equal(JSON.stringify(records.raw('FS-101')), ledgerBefore);
  assert.equal(fake.fields.count.writes.length + fake.fields.state.writes.length, fieldsBefore);
  assert.equal(fake.state.projectionWrites, after.projectionWrites);
});

test('5b. the lookup never creates a record for an issue that has none', async () => {
  const { handlers, records } = build();
  const before = records.map.size;

  const res = await handlers['relay.issue.record']({ payload: { key: 'FS-101' } });
  assert.equal(res.status, 'missing');
  assert.equal(records.map.size, before, 'no record was created by asking');
  assert.equal(records.commits.length, 0, 'the store saw no write');
});

test('6. a tracked-list failure does not fail bootstrap, and is not reported as "not listed"', async () => {
  const { handlers, storage } = build();
  // An existing unmanaged record — discoverable without the list, which is the
  // whole point: the record and the list are different things.
  await handlers['relay.workspace.init']({ payload: { projectKey: 'FS' }, context: ctx });

  const realGet = storage.get.bind(storage);
  let trackedReads = 0;
  storage.get = async (key) => {
    if (key === 'relay:tracked') {
      trackedReads += 1;
      // The first read is buildWorkspace's, and it succeeds. Every later one —
      // the membership probe inside the record lookup — fails.
      if (trackedReads > 1) throw new Error('storage get failed on relay:tracked (simulated)');
    }
    return realGet(key);
  };

  const res = await handlers.bootstrap({ context: ctx });

  assert.equal(panel(res).status, 'unmanaged', 'the record was read, so bootstrap has something to say');
  assert.equal(panel(res).state, 'unmanaged');
  assert.equal(panel(res).inTrackedList, null, 'membership could not be established');
  assert.equal(res.panelTracked, null, 'unknown, and never misreported as `false`');
  assert.equal(res.workspace.issues.length, 0);
  assert.equal(
    trackedReads,
    2,
    'the tracked list is read once by the workspace and once by the lookup — never a third, unguarded time',
  );
});
