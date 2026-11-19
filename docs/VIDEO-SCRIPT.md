# Relay — demo video script

**Target length 3 min 15 s.** Hard limit 5 minutes. One continuous take, no editing, spoken live.
Camera = screen recording (`Win + Alt + R`). Voice = your normal voice, no microphone needed beyond the laptop's.

Read the **SAY** line, do the **DO** line. Nothing else.

---

## Before you press record

| | |
|---|---|
| Tab 1 (left) | portal view of FS-3 — *"View request in portal"* from the Key details box |
| Tab 2 (right) | `https://onepes930.atlassian.net/browse/FS-3` |
| FS-3 status | **In Progress** |
| Promises on FS-3 | two: the tap (**VERIFIED**, kept) and the cartridge (**OPEN**, due Monday) — Closure readiness reads **Blocked · 1** |
| Orange "projection does not match" line | **absent** — that only lasts five minutes after a Reconcile, so reconcile *immediately before* pressing record, not before reading the script |
| Close every other tab | no email, no chat, no Claude, no other Jira tabs |
| Notifications | Windows **Do Not Disturb** on; Jira bell muted |
| Never on screen | the Settings tab, any API token, the manifest, the app ID |
| Zoom | browser at 100–110 %, so the panel text is legible on a phone |

If FS-3 is not *In Progress* with one open promise, stop: add a comment, **Scan comments**, accept, and check the status menu has no `Resolved`. That state is the whole video.

---

## Scene 1 — The problem · 0:00–0:20 · Tab 1

**DO:** sit on the portal page. Don't move the mouse.

**SAY:**
> Facilities work runs on promises. "I'll fix it by Friday." The problem is that Jira has no idea a promise was made. So the case gets closed, and the promise quietly disappears. This is Relay.

## Scene 2 — A real request · 0:20–0:45 · Tab 1

**DO:** scroll slowly down the portal page, showing the request details.

**SAY:**
> A tenant reported a dripping tap in the ground-floor kitchen. That's a real customer account — no agent licence, no Jira access, just the portal. Relay picked the request up the moment it was created.

## Scene 3 — Promises, kept and open · 0:45–1:25 · Tab 2

**DO:** switch to Tab 2. Scroll to the **Commitments** panel. Open the **Cases** tab. Rest the mouse on the two commitment rows. Don't click.

**SAY:**
> The agent replied: "I'll fix the tap by Friday." Relay lifted that exact sentence out of the comment, with the date it implies, and a person accepted it — nothing becomes binding just by being captured.
>
> That promise has been kept. Verified, with what was done, in the trail below.
>
> And here's a second one: the replacement cartridge, due Monday. That one is still open — and look what it does to the case.

## Scene 4 — The case is held · 1:30–2:05 · Tab 2

**DO:** scroll up. Click the status pill (**In Progress**). **Hold the menu open and still for five full seconds.** This is the shot.

**SAY:**
> Now the part that matters. There's one promise open on this case. Look at the status menu: Resolved is gone. Not greyed out — gone. Relay will not let a case close while it owes somebody something.

## Scene 5 — Keeping the promise · 2:05–2:45 · Tab 2

**DO:** close the menu. On the **cartridge** row, expand `Evidence` → **Verify or hand over** → in *What was done?* type, slowly enough to read:

```
Cartridge ordered, fitted and tested; no drip after 20 minutes.
```

Then click the confirm button.

**SAY:**
> The cartridge is fitted. Relay asks what was done, and records the answer, who did it and when — so the promise has an ending, not just a memory. And the moment it's settled, the close option comes back.
>
> *(reopen the status menu, hold two seconds on `Resolved`)*
>
> There it is.

## Scene 6 — The ledger · 2:45–3:10 · Tab 2

**DO:** open the **Overview** tab of the panel.

**SAY:**
> One ledger for the whole project: every promise, who owes it, what's overdue, what's waiting on a person. FS-3 has left the list. FS-1 is still on it — one promise, one reason, and it's settled from here.

## Scene 7 — Close · 3:10–3:25 · Tab 2

**DO:** stop moving. Speak to the screen.

**SAY:**
> Relay. Promises made on a case, tracked until they're kept.

**DO:** press `Win + Alt + R` to stop.

---

## If something goes wrong mid-take

| What happened | Do this |
|---|---|
| Fluffed a line | Keep going. Say the sentence again. A pause reads better than a wrong word. |
| `Resolved` is missing in Scene 5 | The projection has not caught up: open the status menu again after ten seconds. |
| The panel shows a red *"couldn't complete the action"* toast | Reload the page, carry on from the start of the current scene. |
| You finished and want to retake | The demo state is spent. Add a new comment, **Scan comments**, accept the proposal, then **Reconcile** — and Scene 3's state is back. |
| The orange "projection does not match" line appears mid-take | Ignore it; it is the five-minute timer. Do not reconcile mid-take. |

## After the recording

Do **not** delete the file. Do **not** upload yet. Send me: the file name in `Videos → Captures`, and the runtime shown on it.
