# First run on a site that has never seen Relay

What a judge actually gets, recorded on a site created for the purpose and
never configured by hand. Every claim here was observed; nothing is inferred
from the development site.

- App: production, installed through the developer console installation link.
- Site: `onepes930-1794836269806`, created for this test, Jira Software only,
  one team-managed space (`relaytest`), one work item (`KAN-1`).
- Nothing was edited in the manifest, no field id was pasted anywhere, no
  workflow was touched.

## What happens

1. **Install.** Installation link → pick the site → install. The consent
   screen lists exactly what the app uses: view Jira issue data, create and
   manage issues, view user profiles, write app data, app storage.
2. **Open.** Relay appears under *Your apps*. The global page loads with an
   empty state that says what to do next, and names the site it is connected
   to.
3. **Track a case.** Settings → Jira connection → `KAN-1` → Track:
   *KAN-1 is now managed: 0 commitment(s) captured.*
4. **Capture.** A comment on the work item — `I'll fix the tap by Friday.` —
   read by *Scan comments*, becomes a commitment in **Review**, due in three
   days, and the case moves to *held open · 1 unresolved*.

## The three defects this test found, and what fixed them

All three only exist on a site with no history. The development site had
resolved each of them once, early, and then cached the answer — which is
exactly why they were invisible for a month.

1. **The field catalogue was read from the wrong endpoint.**
   `GET /rest/api/3/field` lists 51 fields and **neither** Relay field, even
   though both exist and are visible to administrators. `GET
   /rest/api/3/field/search` lists all 90, in pages.

2. **The app identity is a non-administrator.** Read as the app, the same
   catalogue returns 51 fields and **zero** app-owned ones; read as the signed
   in user, 90 including both Relay fields. Jira hides a field that is on no
   screen from everyone but an administrator. The read is now attempted as the
   user, and falls back to the app identity where there is no user.

3. **A field nobody can read back is a mirror gap, not a refused write.** The
   private app-field write returns 204 and the value reads back `null`, because
   the app cannot see a field that is on no screen. Enforcement never depended
   on those fields — the workflow condition reads the issue property
   `relay.closure`, which is written and read back and checked separately. A
   null read is now logged as `field_mirror_unreadable` and the operation
   continues; a read that returns a *different* value is still a hard failure.

Defect 3 changes what Relay claims: the two custom fields are a mirror for
humans, not a precondition for enforcement. When they cannot be read, the
console says so instead of refusing to work.

## What a fresh install still needs from an administrator

Stated because it is true, not because it is convenient:

- **A workflow rule has to be attached by hand.** Relay ships the validator and
  the condition as manifest modules, but Jira requires an administrator to add
  them to a workflow transition. Until that is done, nothing is withheld. The
  console names the transition to attach them to.
- **The customer-portal half needs Jira Service Management.** On a Jira
  Software-only site there is no portal to guard.
- **The issue panel does not render on Jira Software work items.** On a service
  project the *Commitments* panel appears in the middle column; on a plain
  software space it does not, and the cause is not yet known. The global page
  works everywhere.
