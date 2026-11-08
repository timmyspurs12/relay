/**
 * The first ledger write, and what Relay keeps when the platform refuses it.
 *
 * The live failure this file exists for is a Track that dies on
 * `POST /api/v1/entity/set` with:
 *
 *   ForgeKvsAPIError: Request cannot be processed due to one or more semantic errors
 *   HTTP 422
 *
 * `@forge/kvs` builds that exception from the response body
 * (`{ code, message, ...context }`) but only exposes `message` to a caller that
 * reads `err.message`. The service's `code`, the HTTP status, the trace id and
 * any per-attribute context are on the error object and were being thrown away,
 * which is why the live failure could not be attributed to an attribute.
 *
 * These tests do not claim to reproduce the remote rejection — nothing here
 * reaches Forge. They pin the contract that the rejection's *details* survive to
 * the caller, using an error object shaped exactly like the one `@forge/kvs`
 * throws (see its `out/errors.js` and `out/utils/error-handling.js`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createForgeRecords, RECORD_ENTITY, StorageRejected } from '../src/forge-store.js';
import { RecordExists, RevisionConflict } from '../src/store.js';
import { emptyLedger } from '../src/ledger.js';
import { createHandlers } from '../src/handlers.js';
import { createFakeJira, createMemoryStorage, forgeContext, rawComment, rawIssue } from './support/fake-forge.js';

const NOW = '2026-11-07T10:00:00.000Z';
const record = (overrides = {}) => ({ ...emptyLedger('FS-101', NOW, 'initializing'), source: 'track', ...overrides });

/**
 * A stand-in for `ForgeKvsAPIError`, matching what the installed package builds:
 * `name` is 'ForgeKvsError' even for an API error, `message` is the service's
 * sentence, and `responseDetails`/`context` carry everything else.
 */
class FakeKvsApiError extends Error {
  constructor({
    code = 'UNKNOWN_ERROR',
    message = 'Request cannot be processed due to one or more semantic errors',
    status = 422,
    statusText = 'Unprocessable Entity',
    traceId = 'b3:4f1c9a2e77d0',
    context = {},
    path = '/api/v1/entity/set',
  } = {}) {
    super(message);
    this.name = 'ForgeKvsError';
    this.code = code;
    this.context = context;
    this.responseDetails = { status, statusText, traceId, httpMethod: 'POST', httpPath: path, responseBodyLength: 96 };
  }
}

/** A client with the two methods `createForgeRecords` uses, and nothing else. */
function fakeClient({ set, execute } = {}) {
  return {
    entity: () => ({
      get: async () => undefined,
      set: set ?? (async () => {}),
      delete: async () => {},
    }),
    transact: () => ({
      set: () => ({
        execute: execute ?? (async () => {}),
      }),
    }),
  };
}

test('a refused create keeps the platform code, status, trace id and the attributes it sent', async () => {
  const sent = [];
  const records = createForgeRecords(fakeClient({
    set: async (key, value, options) => {
      sent.push({ key, value, options });
      throw new FakeKvsApiError();
    },
  }));

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      assert.ok(err instanceof StorageRejected, 'the rejection is Relay’s own type, not a bare ForgeKvsAPIError');
      assert.equal(err.code, 'storage_rejected');
      assert.equal(err.platformCode, 'UNKNOWN_ERROR', 'the service code survives');
      assert.equal(err.status, 422);
      assert.equal(err.traceId, 'b3:4f1c9a2e77d0');
      assert.equal(err.operation, 'create');
      assert.equal(err.entityName, RECORD_ENTITY);
      assert.equal(err.issueKey, 'FS-101');
      assert.match(err.message, /HTTP 422/);
      assert.match(err.message, /one or more semantic errors/, 'the service’s own sentence is still there');
      assert.match(err.message, /trace b3:4f1c9a2e77d0/);
      return true;
    },
  );

  // The request itself is unchanged: create-only, one entity, the encoded record.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, 'FS-101');
  assert.deepEqual(sent[0].options, { keyPolicy: 'FAIL_IF_EXISTS' });
  assert.deepEqual(Object.keys(sent[0].value).sort(), [
    'commitments', 'digest', 'issueKey', 'rev', 'source', 'state', 'updatedAt', 'version',
  ]);
});

test('the attributes are reported by name and type, never by value', async () => {
  const records = createForgeRecords(fakeClient({
    set: async () => { throw new FakeKvsApiError(); },
  }));

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      const byName = Object.fromEntries(err.attributes.map(({ attribute, type }) => [attribute, type]));
      assert.equal(byName.version, 'integer');
      assert.equal(byName.rev, 'integer');
      assert.equal(byName.commitments, 'array', 'an empty commitment list is still an array');
      assert.equal(byName.digest, 'string');
      assert.equal(byName.issueKey, 'string');

      // A record carries comment text and people's names; the message is shown
      // in the workspace and written to the log, so it names attributes only.
      assert.doesNotMatch(err.message, /initializing/, 'no attribute values in the message');
      assert.doesNotMatch(err.message, /0:811c9dc5/);
      return true;
    },
  );
});

test('a service context naming a property is carried through', async () => {
  const records = createForgeRecords(fakeClient({
    set: async () => {
      throw new FakeKvsApiError({
        code: 'INCORRECT_PROPERTY_TYPE',
        context: { property: 'updatedAt', expected: 'string' },
      });
    },
  }));

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      assert.equal(err.platformCode, 'INCORRECT_PROPERTY_TYPE');
      // The offending attribute is named; the service's other keys are types.
      assert.match(err.message, /Platform context: property=updatedAt, expected=string;/);
      return true;
    },
  );
});

test('a refusal is raised once and never retried or reported as success', async () => {
  let calls = 0;
  const records = createForgeRecords(fakeClient({
    set: async () => {
      calls += 1;
      throw new FakeKvsApiError();
    },
  }));

  await assert.rejects(() => records.create('FS-101', record()), StorageRejected);
  assert.equal(calls, 1);
});

test('an existing key is still a RecordExists, and not reported as a rejection', async () => {
  const records = createForgeRecords(fakeClient({
    set: async () => {
      const err = new FakeKvsApiError({ code: 'KEY_CONFLICT', message: 'Key already exists', status: 409, statusText: 'Conflict' });
      throw err;
    },
  }));

  await assert.rejects(() => records.create('FS-101', record()), RecordExists);
});

test('a failed condition is still a RevisionConflict; a semantic refusal is not', async () => {
  const conflicting = createForgeRecords(fakeClient({
    execute: async () => {
      const err = new FakeKvsApiError({ code: 'CONDITIONAL_CHECK_FAILED', message: 'Conditional check failed', status: 400, statusText: 'Bad Request' });
      throw err;
    },
  }));
  await assert.rejects(() => conflicting.update('FS-101', 3, record({ rev: 4 })), RevisionConflict);

  const refused = createForgeRecords(fakeClient({
    execute: async () => { throw new FakeKvsApiError(); },
  }));
  await assert.rejects(
    () => refused.update('FS-101', 3, record({ rev: 4 })),
    (err) => {
      assert.ok(err instanceof StorageRejected);
      assert.equal(err.operation, 'update');
      assert.equal(err.status, 422);
      return true;
    },
  );
});

test('a failure that is not the platform’s is not disguised as a storage rejection', async () => {
  const records = createForgeRecords(fakeClient({
    set: async () => { throw new TypeError('fetch failed'); },
  }));

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      assert.ok(!(err instanceof StorageRejected), 'a network error stays a network error');
      assert.equal(err.name, 'TypeError');
      return true;
    },
  );
});

/**
 * The proof that the test above is not passing by accident.
 *
 * `createForgeRecords` takes its client as a parameter; if `create` closed over
 * the module-level `kvs` binding instead, the fake's `set` would never run and
 * the assertions on `sent`/`err.traceId` above would be unreachable. Outside
 * Forge the module-level path fails with `TypeError: global.__forge_fetch__ is
 * not a function` (verified in this sandbox against the installed
 * `@forge/kvs@2.1.1`), so a sentinel thrown by the injected client can only be
 * observed if the injected client is the one being used.
 */
test('the create path talks to the client it is handed, not the module binding', async () => {
  const sentinel = new Error('WRONG_TRANSPORT_if_you_see_this_the_module_kvs_was_used');
  const records = createForgeRecords({
    entity(name) {
      assert.equal(name, RECORD_ENTITY);
      return {
        get: async () => undefined,
        set: async () => {
          throw sentinel;
        },
      };
    },
    transact() {
      throw new Error('unused');
    },
  });

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      assert.equal(err, sentinel, 'the injected client’s own failure is what surfaces');
      return true;
    },
  );
});

test('the platform context is reported by shape, so a body that echoes a record cannot leak it', async () => {
  // This is the fallback branch of `@forge/kvs`: when the response body is not a
  // `{ code, message }` object it keeps the raw text in `context.responseText`.
  const body = JSON.stringify({
    code: 'INVALID_ENTITY_ATTRIBUTE',
    message: 'attribute name is a reserved value',
    comment: 'Can you send the certificate to the tenant?',
  });
  const records = createForgeRecords(fakeClient({
    set: async () => {
      throw new FakeKvsApiError({ code: 'UNKNOWN_ERROR', context: { responseText: body } });
    },
  }));

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      assert.match(err.message, /responseText:string\(\d+\)/, 'the body is described, not printed');
      assert.doesNotMatch(err.message, /certificate/, 'no record text in the message');
      assert.doesNotMatch(err.message, /reserved value/, 'no body text either');
      return true;
    },
  );
});

test('a naming key from the service survives; anything else is only a type', async () => {
  const records = createForgeRecords(fakeClient({
    set: async () => {
      throw new FakeKvsApiError({
        code: 'INCORRECT_PROPERTY_TYPE',
        context: { property: 'updatedAt', expected: 'string', submitted: 'Can you send the certificate?' },
      });
    },
  }));

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      assert.match(err.message, /property=updatedAt/, 'the offending attribute is named, which is the point');
      assert.match(err.message, /expected=string/);
      assert.doesNotMatch(err.message, /certificate/);
      assert.match(err.message, /submitted:string\(29\)/, 'a non-naming key is a type and a length');
      return true;
    },
  );
});

test('a transport failure that carries a Node error code is not called a store rejection', async () => {
  const records = createForgeRecords(fakeClient({
    set: async () => {
      const err = new Error('read ECONNRESET');
      err.code = 'ECONNRESET';
      throw err;
    },
  }));

  await assert.rejects(
    () => records.create('FS-101', record()),
    (err) => {
      assert.ok(!(err instanceof StorageRejected), 'a socket error keeps its own identity');
      assert.equal(err.code, 'ECONNRESET');
      return true;
    },
  );
});

/**
 * The end of the wire: the same refusal, driven through the real handler with
 * the real wrapper. This is the assertion that the details actually reach the
 * console, because a wrapper nobody reads is the failure being repaired.
 */
test('a refused first write reaches the console as a failed Track, with the code and the trace id', async () => {
  const logs = [];
  let attempts = 0;
  const records = createForgeRecords(fakeClient({
    set: async () => {
      attempts += 1;
      throw new FakeKvsApiError({ context: { responseText: '{"errors":[{"code":"semantic","property":"updatedAt"}]}' } });
    },
  }));
  const storage = createMemoryStorage();
  const fake = createFakeJira({
    issue: rawIssue(),
    comments: [rawComment()],
    people: [{ id: 'acc-maya', name: 'Maya Okafor' }],
  });
  const handlers = createHandlers({
    jira: fake.jira,
    storage,
    records,
    now: () => new Date(NOW),
    log: (entry) => logs.push(entry),
  });

  const res = await handlers['relay.workspace.track']({ payload: { key: 'FS-101' }, context: forgeContext() });

  assert.equal(res.track.status, 'failed', 'a refused create is reported, not thrown past the caller');
  assert.equal(res.track.stage, 'record_initialise', 'and it says which write it was');
  assert.equal(res.track.state, 'initializing', 'fail-closed: the issue is withheld');
  assert.equal(res.track.platformCode, 'UNKNOWN_ERROR');
  assert.equal(res.track.httpStatus, 422);
  assert.equal(res.track.traceId, 'b3:4f1c9a2e77d0');
  assert.match(res.track.error, /storage_rejected: create of relay-ledger\/FS-101/);
  assert.doesNotMatch(res.track.error, /semantic","property/, 'no body text carried into the console message');
  assert.equal(attempts, 1, 'one attempt: a refusal is not retried');
  assert.equal(await records.read('FS-101'), null, 'nothing was persisted');

  const failed = res.track.steps.find((s) => s.stage === 'failed');
  assert.equal(failed.failedStage, 'record_initialise');

  const logged = logs.find((entry) => entry.event === 'track_failed');
  assert.ok(logged, 'the failure is in the log, where an operator can find it');
  assert.equal(logged.stage, 'record_initialise');
  assert.equal(logged.platformCode, 'UNKNOWN_ERROR');
  assert.equal(logged.traceId, 'b3:4f1c9a2e77d0');
  assert.equal(
    logs.some((entry) => entry.event === 'track_initializing_restore_failed'),
    false,
    'no record was created, so there is no state to restore',
  );
});
