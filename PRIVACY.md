# Privacy policy — Relay

_Last updated: 30 October 2026_

Relay is a Jira Service Management app that tracks the promises made on a support case and holds the case open until they are settled.

## What Relay stores

For each issue it tracks, Relay writes:

| Data | Where | Why |
|---|---|---|
| The issue key, its Relay state (`managed` / `unmanaged` / `initializing`), a revision number and timestamps | Forge app storage (`relay-ledger` entity) | The authority for every closure decision |
| The commitments on that issue: the sentence quoted from a comment, the account ID of the owner, the due date Relay inferred, its status | Forge app storage | So a promise survives the person who made it |
| An audit trail of events (captured, accepted, verified, reassigned, dropped) | Forge app storage | "Who changed this promise, and when" is answerable |
| An open-commitment count and a management state | Two read-only Jira custom fields | Shown in the issue; the closure rule reads the projection |
| A small projection (state, open/overdue/unowned counts, revision) | The issue's `relay.closure` property | The only thing a workflow condition can read |

Commitment text is copied from Jira comments. It may contain personal data if somebody wrote personal data in a comment — a name, a phone number, a flat number. Relay does not add any.

## What Relay does not do

- It does **not** send data anywhere outside Atlassian. There is no analytics, no telemetry, no third-party endpoint, no external server. Everything runs on the Forge platform inside your Atlassian cloud instance.
- It does **not** read data from projects where it is not installed and has no record.
- It does **not** store credentials, tokens, or anything belonging to a user's Atlassian account beyond the account ID that Jira itself uses.

## Who can see it

Anyone who can see the issue in Jira can see the two custom fields and the closure projection. Portal (customer) users may be able to read the projection; they cannot read the ledger, the audit trail, or the commitment text Relay stores in app storage.

## Retention

Commitments and audit events are kept until the issue's record is deleted or the app is uninstalled. Uninstalling Relay removes its Forge app storage. **The custom fields and the `relay.closure` issue property stay on your issues** after uninstall, because they are written into Jira rather than kept in the app; an administrator can remove the fields, and the property can be cleared with the Jira REST API.

## Contact

Questions, or a deletion request: open an issue at <https://github.com/timmyspurs12/relay/issues>.
