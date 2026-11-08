/**
 * The Forge bindings for Relay's storage.
 *
 * Everything here is deliberately thin and is imported *only* by the Forge
 * entry points (`resolvers.js`, `index.js`). The product code in `store.js`
 * talks to the interfaces defined here, so the tests can run the real
 * concurrency logic without Forge and without pretending a serial in-memory
 * map is a database.
 *
 * ## Why the record is an entity, not a key
 *
 * `kvs.set` is a blind overwrite. The Custom Entity Store gives Relay two
 * things a plain key cannot:
 *
 *   * a **conditional write** — `kvs.transact().set(key, value, { entityName,
 *     conditions })` is committed only if the conditions still hold when the
 *     transaction lands, which is compare-and-swap on the revision;
 *   * **create-only** writes — `entity.set(key, value, { keyPolicy:
 *     'FAIL_IF_EXISTS' })`, which is how two simultaneous Track clicks, or the
 *     creation trigger racing the backfill, produce one record and not two.
 *
 * The entity is declared in `manifest.yml` under `app.storage.entities`; the
 * attribute list there is exhaustive because the store enforces types.
 */
import { kvs, Filter, FilterConditions, WhereConditions } from '@forge/kvs';
import { RecordExists, RevisionConflict, isAlreadyExists, isConditionFailed } from './store.js';
import { fromStored, toStored } from './record-codec.js';

/** Must match `app.storage.entities[].name` in manifest.yml. */
export const RECORD_ENTITY = 'relay-ledger';

/**
 * A write the entity store refused for a reason that is not a conflict.
 *
 * `ForgeKvsAPIError` keeps the platform's `code`, the response status and trace
 * id, and whatever `context` the service attached — but its `message` is only
 * the service's sentence. A `422 UNPROCESSABLE_ENTITY` whose whole message is
 * "Request cannot be processed due to one or more semantic errors" therefore
 * reaches the caller with the one thing that would identify it stripped off.
 * That is the error this record's first write fails with, so Relay re-attaches
 * the parts: the operation, the entity, the platform's code, the status, the
 * trace id, the service's context, and the attributes that were sent (names and
 * types only — never values, because a record holds comment text).
 */
export class StorageRejected extends Error {
  constructor({ operation, entityName, issueKey, attributes, cause }) {
    // `UNKNOWN_ERROR` is not a placeholder of ours: `@forge/kvs` itself uses it
    // when the response body is not a `{ code, message }` object
    // (`out/utils/error-handling.js`), which is also the branch that keeps the
    // raw body in `context.responseText`. So the code is reported as it comes,
    // and `context` is summarised by shape rather than dumped.
    const code = cause?.code || 'UNKNOWN_ERROR';
    const status = cause?.responseDetails?.status ?? null;
    const traceId = cause?.responseDetails?.traceId ?? null;
    const sent = attributes.map(({ attribute, type }) => `${attribute}:${type}`).join(', ');
    const context = describeContext(cause?.context);

    super(
      `storage_rejected: ${operation} of ${entityName}/${issueKey} was refused by the Forge entity store` +
        `${status === null ? '' : ` (HTTP ${status})`}, code ${code}${traceId ? `, trace ${traceId}` : ''}.` +
        ` The store said: ${JSON.stringify(String(cause?.message ?? cause))}.` +
        ` Attributes sent: ${sent}.${context}`,
    );
    this.name = 'StorageRejected';
    this.code = 'storage_rejected';
    /** What the platform called it. `UNKNOWN_ERROR` when the body carried none. */
    this.platformCode = code;
    this.status = status;
    this.traceId = traceId;
    this.operation = operation;
    this.entityName = entityName;
    this.issueKey = issueKey;
    /** `[{ attribute, type }]` — the contract the deployed entity has to accept. */
    this.attributes = attributes;
    this.cause = cause;
  }
}

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max)}…`);

/**
 * Context keys whose *value* names a schema element rather than holding a
 * record's contents. Everything else is reported as a type, never a value.
 */
const NAMING_KEYS = new Set(['property', 'attribute', 'field', 'expected', 'type', 'path']);

/**
 * The shape of an arbitrary JSON value: keys, types, array and string lengths.
 *
 * `@forge/kvs` folds every key of the response body that is not
 * `code`/`message`/`context` into `context` (`ForgeKvsAPIError`'s constructor),
 * and when the body is not a `{ code, message }` object it puts the whole raw
 * body in `context.responseText`. That body can echo what was submitted, and a
 * Relay record holds comment text and people's names, so the context is never
 * printed: the caller gets its schema instead — which is what identifies the
 * offending attribute anyway.
 */
function shapeOf(value, depth = 0) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  if (typeof value === 'string') return `string(${value.length})`;
  if (typeof value !== 'object') return typeof value;
  const keys = Object.keys(value);
  if (depth >= 2) return `object(${keys.length})`;
  const shown = keys.slice(0, 12).map((key) => `${key}:${shapeOf(value[key], depth + 1)}`);
  const extra = keys.length > 12 ? `,+${keys.length - 12}` : '';
  return `{${shown.join(',')}${extra}}`;
}

/** A value-free description of the platform's `context`, or `''`. */
function describeContext(context) {
  if (!context || typeof context !== 'object' || Object.keys(context).length === 0) return '';
  const named = Object.entries(context)
    .filter(([key, value]) => NAMING_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number'))
    .map(([key, value]) => `${key}=${clip(String(value), 60)}`);
  return ` Platform context: ${named.length ? `${named.join(', ')}; ` : ''}body ${clip(shapeOf(context), 400)}.`;
}

/** Attribute names and the type each value claims. Values are never included. */
function describeAttributes(stored) {
  return Object.entries(stored).map(([attribute, value]) => ({
    attribute,
    type: Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value,
  }));
}

/**
 * The platform's own failures are the ones worth re-wrapping. A network error
 * (`fetch failed`) or a bug in this file is not a storage rejection, and saying
 * it was would send the next person looking in the wrong place.
 *
 * `ForgeKvsError` is the package's own base class (`name` is set to
 * 'ForgeKvsError' even for an API error). Testing for a string `code` alone
 * would also match Node system errors (`ECONNRESET`, `EAI_AGAIN`) and relabel
 * an outage as a store rejection.
 */
function isPlatformApiError(err) {
  return Boolean(err && typeof err === 'object' && (err.name === 'ForgeKvsError' || err.responseDetails));
}

function platformRejection(operation, issueKey, stored, cause) {
  return new StorageRejected({
    operation,
    entityName: RECORD_ENTITY,
    issueKey,
    attributes: describeAttributes(stored),
    cause,
  });
}

/** The page size the KVS query API accepts per request. */
const QUERY_PAGE = 100;

export function createForgeStorage() {
  return {
    get: (key) => kvs.get(key),
    set: (key, value, options) => (options ? kvs.set(key, value, options) : kvs.set(key, value)),
    /**
     * One page of keys under a prefix, newest-first not required by the caller
     * (it sorts). Cursors are forwarded so a trail longer than one page is read
     * completely rather than silently truncated.
     */
    async list(prefix, { limit = 200, cursor } = {}) {
      const items = [];
      let token = cursor ?? null;
      let nextCursor = null;

      while (items.length < limit) {
        const take = Math.min(QUERY_PAGE, limit - items.length);
        let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(take);
        if (token) query = query.cursor(token);
        const page = await query.getMany();
        const results = Array.isArray(page?.results) ? page.results : [];
        for (const row of results) items.push(row.value);
        nextCursor = page?.nextCursor ?? null;
        if (!nextCursor || results.length === 0) {
          nextCursor = null;
          break;
        }
        token = nextCursor;
      }

      return { items, nextCursor };
    },
  };
}

/**
 * Read/commit an issue record with a condition on the revision it was derived
 * from. `expectedRev` is `null` only on create.
 *
 * Every value crosses `record-codec.js` on its way in and out. That is not
 * decoration: the ledger is full of nulls (an owner, a due date, a verification
 * note — all null until something happens) and the Custom Entity Store rejects
 * nulls, empty strings and undeclared attributes with
 * `422 UNPROCESSABLE_ENTITY`. Encoding here keeps the domain honest and keeps
 * the constraint in exactly one place.
 *
 * `toStored` throws *before* the network call when a record cannot be stored, so
 * the failure names the attribute instead of surfacing as an opaque 422; it is
 * not retried by `store.js` (only conflicts are) and it is never reported as a
 * successful write.
 */
export function createForgeRecords(client = kvs) {
  const entity = client.entity(RECORD_ENTITY);

  return {
    async read(issueKey) {
      const stored = await entity.get(issueKey);
      return stored ? fromStored(stored) : null;
    },

    async create(issueKey, record) {
      const stored = toStored(record);
      try {
        await entity.set(issueKey, stored, { keyPolicy: 'FAIL_IF_EXISTS' });
      } catch (err) {
        if (isAlreadyExists(err)) throw new RecordExists(issueKey);
        if (isPlatformApiError(err)) throw platformRejection('create', issueKey, stored, err);
        throw err;
      }
    },

    async update(issueKey, expectedRev, record) {
      const stored = toStored(record);
      try {
        await client
          .transact()
          .set(issueKey, stored, {
            entityName: RECORD_ENTITY,
            // The commit lands only while the stored revision is still the one
            // the mutation was derived from. This is the compare in
            // compare-and-swap.
            conditions: new Filter().and('rev', FilterConditions.equalTo(expectedRev)),
          })
          .execute();
      } catch (err) {
        // A failed condition means someone else committed first: that is a
        // conflict to retry, not an outage to report.
        if (isConditionFailed(err)) throw new RevisionConflict(expectedRev);
        if (isPlatformApiError(err)) throw platformRejection('update', issueKey, stored, err);
        throw err;
      }
    },
  };
}
