# Agent Hooks: Session Log and Guardrails

An opt-in capability (`sdd-init --guardrails`) that records what an agent actually did
during a task, instead of relying only on its own final report, and denies one specific
dangerous action before it runs: a raw `kill`/`pkill`/`killall` shell command.

This is deliberately **agent-agnostic in its core**, even though Claude Code is the only
agent with a shipped adapter today. If you use a different AGENTS.md-aware agent that
exposes its own hook mechanism, write an adapter for it (see below) instead of waiting
for this framework to add one.

## Why this exists

The constitution's Rule 3 (`.agents/AGENTS.md`) requires naming the exact identifier
behind any claim of having stopped a process or resource. That rule is prose: nothing
mechanically checks it. A past incident (see `fix-and-verify`'s skill notes) had a
subagent kill a pre-existing, unrelated process and then report having stopped "its
own" test server on a different port -- a false claim about a system action, caught only
because someone happened to check.

This capability closes the *preventable* half of that gap: a raw `kill`/`pkill`
invocation is denied outright, so there is no raw-PID path to misidentify a process on.
It does **not** close the *verifiable-after-the-fact* half -- no agent hook mechanism
available today exposes a spawned PID for a backgrounded task, or an API to ask "which
PIDs did this session spawn." A denied kill is logged; a legitimately stopped background
task (through the harness's own tool for it, e.g. Claude Code's `TaskStop`) is not
something this capability can independently confirm actually happened. Say what this
does and does not cover; don't imply more than it delivers.

## The event schema

One JSON object per line in `.sdd/session-log.jsonl` (gitignored -- this is local,
per-session data, not evidence committed to the repo):

```json
{
  "ts": "2026-09-28T04:20:00.000Z",
  "agent": "claude-code",
  "event": "pre",
  "tool": "Bash",
  "command": "npm start",
  "filePath": null,
  "taskId": "T3",
  "exitCode": 0,
  "denied": false,
  "reason": null
}
```

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `ts` | yes | ISO 8601 timestamp, set by the adapter at normalization time. |
| `agent` | yes | Which agent produced this event (`"claude-code"`, etc.). |
| `event` | yes | `"pre"` (before the tool runs) or `"post"` (after it ran). |
| `tool` | yes | The tool name in that agent's own vocabulary (`"Bash"`, `"Edit"`, ...). |
| `command` | no | The shell command, for a `Bash`-like tool. |
| `filePath` | no | The file touched, for an `Edit`/`Write`-like tool. |
| `taskId` | no | The spec task ID this happened under, read from `.sdd/current-task` (see below) -- `null` if that marker file doesn't exist. |
| `exitCode` | no | The tool's exit code, on a `"post"` event, when the agent's hook payload includes one. |
| `denied` | no | `true` if this event was the guardrail denying the action. |
| `reason` | no | Why it was denied. |

`.sdd/current-task` is an optional, single-line marker file (also gitignored) holding
the current task ID in the same format `lib/spec.js` parses from a spec's task headers
(e.g. `T3`). Nothing requires an agent to maintain it; without it, every event just
carries `taskId: null`. Writing it is a convention an `AGENTS.md` can ask an agent to
follow at the start of each task -- this framework does not enforce it.

## The adapter interface

`scripts/lib/hook-adapters/<name>.js` exports one function:

```js
function normalize(rawHookPayload) {
  // returns an event object matching the schema above (ts/agent/event/tool required,
  // the rest optional), or throws if the payload isn't one this adapter understands.
}
module.exports = { normalize };
```

`scripts/hooks-handler.js --adapter=<name>` reads one JSON payload from stdin, calls
that adapter's `normalize()`, fills in `taskId` from `.sdd/current-task`, appends the
result to the session log, and -- for a `"pre"` `Bash` event whose `command` matches a
raw kill -- denies it (exit code `2`, a message on stderr) instead of just logging it.
A hook payload the adapter can't parse, or any other internal failure, is reported on
stderr and the action is **allowed through** (exit code `0`): a broken logger must never
be the reason an unrelated tool call gets blocked.

## Shipped adapter: Claude Code

`scripts/lib/hook-adapters/claude-code.js` normalizes Claude Code's
[PreToolUse/PostToolUse hook payload](https://docs.claude.com/en/docs/claude-code/hooks)
(`hook_event_name`, `tool_name`, `tool_input`, and `tool_response` on `PostToolUse`).
`sdd-init --guardrails` wires it into `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .sdd/scripts/hooks-handler.js --adapter=claude-code" }] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .sdd/scripts/hooks-handler.js --adapter=claude-code" }] }]
  }
}
```

If `.claude/settings.json` already exists, `sdd-init` merges this entry into it instead
of overwriting whatever hooks are already configured there.

## Adding an adapter for another agent

1. Find that agent's own hook/callback mechanism (if it has one) and the shape of the
   payload it hands your command.
2. Write `scripts/lib/hook-adapters/<agent-name>.js` with a `normalize()` following the
   interface above. Put it in your project (or contribute it upstream) -- it does not
   need to live in this framework's repository to work.
3. Point that agent's own hook configuration at
   `node .sdd/scripts/hooks-handler.js --adapter=<agent-name>`.
4. If the agent has no hook mechanism at all, this capability simply does not apply to
   it -- the rest of the framework (the constitution, `sdd-verify`, the quality gate)
   still works the same way it does today, since none of it depends on this.

## Turning it off

`sdd.config.json`: `capabilities.guardrails.enabled: false` disables the deny behavior
(events still log). To stop logging entirely, remove the hook entries from
`.claude/settings.json` (or the equivalent for your adapter) and re-run `sdd-init`
without `--guardrails`.
