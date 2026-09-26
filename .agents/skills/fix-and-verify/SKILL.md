---
name: fix-and-verify
description: "Investigate and resolve a bug report, including a vague one ('this doesn't work', 'it looks wrong', a one-line client complaint with no repro steps), with reproduction before diagnosis and independent, evidence-backed verification before claiming done. Use for any single-session bug fix, whether or not the project has adopted the full spec lifecycle -- a quick 'fix this' ask inherits the same evidence standard as a tracked task. Triggers: 'this doesn't work', 'fix this bug', 'it looks wrong', 'the client/user says', a complaint with no repro steps, being asked to fix something another agent already touched and reported as done. NOT for multi-phase or multi-session work handed to a different implementing agent -- see auditor-executor-protocol for that."
---

# Fix and Verify

A vague bug report is not an invitation to guess. This exists because the two most
expensive failures in a bug-fix task both look identical to a rushed, confident report:
a fix that patches the wrong thing, and a fix that's real but never actually checked.

## 1. Reproduce before you diagnose

Never fix a symptom you haven't seen yourself. A one-line complaint ("se ve mal", "this
doesn't work") describes what the user perceived, not the mechanism -- go observe the
actual failure (run the app, read the log, load the actual page) before touching a
single file. If a previous engineer or agent already touched this and reported it fixed,
do not trust that report either: reproduce the *original* complaint yourself first, on
the current state of the code, before deciding whether their fix actually closed it.

## 2. Read the full source of anything load-bearing

Grep finds a string; it does not tell you whether a class is used elsewhere, whether a
rule is overridden further down the file, or whether a fix for one element also covers a
sibling that has the same shape. Read the actual file for anything the fix depends on.

## 3. Tests passing is not evidence for a class of bug tests can't see

A backend/unit test suite exercises logic, not rendering. If the complaint is about
anything a user perceives visually or interactively -- a layout, a form, a screen
transition, an overlapping element -- a green suite tells you nothing about whether the
complaint is resolved, because no unit test renders CSS or exercises the DOM's `hidden`
attribute against the cascade. Confirm the fix the same way the complaint was raised:
drive the actual interface, the same flow the user described.

## 4. Minimal, scoped fix

Fix the reported failure. Do not refactor adjacent code, rename things, or "while I'm
here" clean up unrelated issues -- note them separately if they're worth flagging, but
scope creep on a bug-fix task is itself a defect (see Rule 6, Scope Bounding, in
`AGENTS.md`).

## 5. Verify by re-running the exact repro, not a nearby one

Re-run the precise steps that surfaced the complaint after the fix, in a fresh session/
page load, not a variation that happens to look clean. Fixing one visible symptom (e.g.
two forms toggling correctly) is not the same as fixing the complaint (e.g. the screen
staying stacked after login) if the two share a root cause but not a code path. Before
reporting done, ask: does this exact repro, run again, now show the correct result? If
you can't answer that from something you just ran, you don't have a verified fix yet.

## 6. Never claim credit for cleaning up a resource you didn't create

If you started a server, process, or container to test the fix, stop only that one, and
report the specific identifier (PID, port, handle) you yourself created it with. A
process that predates your task, or one you didn't verify the origin of, is out of scope
to touch and out of scope to claim you stopped -- "confirmed nothing is listening" is not
the same claim as "confirmed *the process I started* is gone," and conflating the two in
a report has caused a pre-existing, unrelated process to be killed without authorization
while the report described it as the agent's own test server.

## 7. Report what you found, not how confident you feel

State: what was still broken, the root cause, exactly what changed, and the repro output
that confirms it's fixed now. "Should be fixed" or "this looks correct now" is not a
substitute for pasting the result of re-running the repro.
