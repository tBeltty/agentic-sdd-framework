/**
 * scripts/lib/session-log.js
 *
 * Agent-agnostic session activity log. A hook adapter (scripts/lib/hook-adapters/*.js)
 * normalizes one agent's own hook payload into the event shape below; this module only
 * ever reads and writes that normalized shape, so it never depends on any single agent's
 * hook format. See docs/guides/AGENT_HOOKS.md for the schema and how to add an adapter.
 *
 * Event shape (one JSON object per line in .sdd/session-log.jsonl):
 *   { ts, agent, event: "pre" | "post", tool, command?, filePath?, taskId?, exitCode?,
 *     denied?, reason? }
 * Every field but ts/agent/event/tool is optional and omitted when not applicable.
 */

const fs = require('fs');
const path = require('path');

const LOG_PATH = '.sdd/session-log.jsonl';
const CURRENT_TASK_PATH = '.sdd/current-task';

// A heuristic on the command's word boundaries, not a real shell parser: it looks for
// kill/pkill/killall as a whole word at the start of the command or right after a
// separator (;, &, |, a subshell, or a newline), so "grep kill" or "echo killer" don't
// match. It can still be evaded on purpose (e.g. `xargs kill`, a script that wraps kill in
// a function) -- this blocks the negligent case from the original incident, not every way
// to kill a process from a shell.
const KILL_PATTERN = /(?:^|[;&|]|\$\(|`|\n)\s*(kill|pkill|killall)(?=\s|$)/;

function sessionLogPath(root) {
    return path.join(root, LOG_PATH);
}

function currentTaskPath(root) {
    return path.join(root, CURRENT_TASK_PATH);
}

// Optional marker file, one line, the task ID an agent is currently working (matching the
// "T1" style id lib/spec.js parses from a spec's task headers). Absent by default: nothing
// requires an agent to maintain it, so entries without it just carry taskId: null.
function readCurrentTask(root) {
    const file = currentTaskPath(root);
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf8').trim();
    return text || null;
}

function appendEvent(root, event) {
    if (!event || typeof event !== 'object') throw new Error('appendEvent needs an event object.');
    for (const field of ['ts', 'agent', 'event', 'tool']) {
        if (!event[field]) throw new Error(`appendEvent: event.${field} is required.`);
    }
    if (event.event !== 'pre' && event.event !== 'post') {
        throw new Error(`appendEvent: event.event must be "pre" or "post", got "${event.event}".`);
    }
    const file = sessionLogPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + '\n');
}

function readEvents(root) {
    const file = sessionLogPath(root);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
}

function matchesKillCommand(command) {
    return typeof command === 'string' && command.length > 0 && KILL_PATTERN.test(command);
}

module.exports = {
    LOG_PATH, CURRENT_TASK_PATH,
    sessionLogPath, currentTaskPath, readCurrentTask,
    appendEvent, readEvents, matchesKillCommand
};
