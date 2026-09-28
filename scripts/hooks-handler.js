#!/usr/bin/env node

/**
 * scripts/hooks-handler.js
 *
 * CLI entrypoint an agent's own hook mechanism calls on every tool use. Reads one hook
 * payload as JSON on stdin, normalizes it with the given adapter
 * (scripts/lib/hook-adapters/<name>.js) into this framework's agent-agnostic session-log
 * event, and appends it to .sdd/session-log.jsonl. A PreToolUse Bash call that raw-kills a
 * process is denied (exit 2) instead of logged as an ordinary event -- see
 * docs/guides/AGENT_HOOKS.md for the event schema, the adapter interface, and this
 * guardrail's actual scope (it prevents the negligent case, it does not verify a
 * stopped-process claim after the fact).
 *
 * Usage: node hooks-handler.js --adapter=<name> < hook-payload.json
 */

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { appendEvent, readCurrentTask, matchesKillCommand } = require('./lib/session-log');

const USAGE = 'Usage: hooks-handler --adapter=<name> < hook-payload.json';

function loadAdapter(name) {
    const file = path.join(__dirname, 'lib/hook-adapters', `${name}.js`);
    if (!fs.existsSync(file)) throw new Error(`No adapter "${name}" at ${file}. ${USAGE}`);
    return require(file);
}

function parseArgs(argv) {
    const flag = argv.find(a => a.startsWith('--adapter='));
    if (!flag) throw new Error(`--adapter is required. ${USAGE}`);
    const adapter = flag.slice('--adapter='.length);
    if (!adapter) throw new Error(`--adapter needs a value. ${USAGE}`);
    return { adapter };
}

const DENIAL_MESSAGE = [
    "Denied: raw process-kill commands are blocked by this project's guardrail.",
    'Stop a background task you started through the harness\'s own tool for it (for example',
    "Claude Code's TaskStop) -- it only ever targets a process this session itself spawned.",
    'A process you did not start that way is out of scope to touch, and out of scope to',
    'claim you stopped (see Rule 3 in .agents/AGENTS.md and the fix-and-verify skill).'
].join('\n');

function handle({ root = repoRoot(), adapterName, raw }) {
    const adapter = loadAdapter(adapterName);
    const event = adapter.normalize(JSON.parse(raw));
    event.taskId = readCurrentTask(root);

    const guardrailsEnabled = getIn(loadConfig(root), 'capabilities.guardrails.enabled', true) !== false;
    const isDeniableKill = guardrailsEnabled && event.event === 'pre' && event.tool === 'Bash' && matchesKillCommand(event.command);
    if (isDeniableKill) {
        event.denied = true;
        event.reason = 'raw kill/pkill/killall command';
    }
    appendEvent(root, event);
    return isDeniableKill ? { exitCode: 2, message: DENIAL_MESSAGE } : { exitCode: 0 };
}

function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(2);
    }
    let raw;
    try {
        raw = fs.readFileSync(0, 'utf8');
    } catch (error) {
        console.error(`❌ Could not read hook payload from stdin: ${error.message}`);
        process.exit(2);
    }
    try {
        const { exitCode, message } = handle({ adapterName: options.adapter, raw });
        if (message) console.error(message);
        process.exit(exitCode);
    } catch (error) {
        // A hook that crashes must not silently block every tool call: report the failure
        // and let the action through, rather than jamming the agent because the logger broke.
        console.error(`⚠️  hooks-handler failed, allowing the action through: ${error.message}`);
        process.exit(0);
    }
}

if (require.main === module) main();

module.exports = { handle, loadAdapter, parseArgs, DENIAL_MESSAGE };
