# Support — Relay

Relay tracks the promises made on a Jira Service Management case and holds the case open until they are settled.

## Getting help

Open an issue: <https://github.com/timmyspurs12/relay/issues>

Please include the issue key, what you expected, what happened, and the exact text of any error Relay showed. Do not paste API tokens.

## Known limitations

These are real, and they are the ones that will bite first:

1. **A fresh install enforces nothing.** Jira gives an app no way to attach its own workflow rule. An administrator must attach the validator (`Relay closure gate`) and the condition (`Relay closure readiness`) to the closure transition in the workflow editor, then run **Backfill** and **Reconcile** from the app's Settings → Enforcement screen. Until that is done the app is installed but idle.
2. **A record must exist before a case can close.** Relay withholds closure for any issue it has no record of, which is the safe direction but means **Backfill must run before the rules are attached**.
3. **Unaccepted suggestions block.** A promise Relay lifts from a comment withholds the closure transition before anybody accepts it. A throwaway line in a note ("I'll be back on Monday") will silence the close button on that case until the suggestion is reviewed.
4. **The condition cannot explain itself.** When it withholds a transition, a portal customer sees Jira's own refusal — or nothing at all. Explain policy in the portal, not through the rule.
5. **Customer-transition support is not proven.** Relay's condition is only exercised for agent and REST transitions. Treat customer-initiated closure as untested.
6. **Jira Service Management is required** for the portal half. Jira alone gets you the issue panel and the agent-side validator.

## Data

See [PRIVACY.md](PRIVACY.md).
