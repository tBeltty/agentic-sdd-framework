const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { tempRepo, writeFiles } = require('./helpers');
const { readEvents } = require('../scripts/lib/session-log');

const HANDLER = path.join(__dirname, '..', 'scripts', 'hooks-handler.js');

function runHandler(cwd, args, stdin) {
    return execFileSync(process.execPath, [HANDLER, ...args], {
        cwd, input: stdin, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
}

function runHandlerExpectFailure(cwd, args, stdin) {
    try {
        runHandler(cwd, args, stdin);
        assert.fail('expected hooks-handler to exit non-zero');
    } catch (error) {
        return error; // execFileSync throws on non-zero exit; the error carries status/stdout/stderr.
    }
}

test('an ordinary Bash command is logged and allowed through', () => {
    const root = tempRepo();
    const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    runHandler(root, ['--adapter=claude-code'], payload);

    const events = readEvents(root);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].command, 'npm test');
    assert.strictEqual(events[0].denied, undefined);
});

test('a raw kill command is denied (exit 2), logged as denied, and explains the fix', () => {
    const root = tempRepo();
    const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'kill 1234' } });
    const error = runHandlerExpectFailure(root, ['--adapter=claude-code'], payload);

    assert.strictEqual(error.status, 2);
    assert.match(error.stderr, /Denied: raw process-kill commands/);
    assert.match(error.stderr, /TaskStop/);

    const events = readEvents(root);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].denied, true);
});

test('capabilities.guardrails.enabled: false allows a kill command through but still logs it', () => {
    const root = tempRepo();
    writeFiles(root, { 'sdd.config.json': JSON.stringify({ capabilities: { guardrails: { enabled: false } } }) });
    const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pkill -f server' } });
    runHandler(root, ['--adapter=claude-code'], payload);

    const events = readEvents(root);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].denied, undefined);
});

test('a PostToolUse event records the exit code and the taskId from .sdd/current-task', () => {
    const root = tempRepo();
    fs.mkdirSync(path.join(root, '.sdd'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sdd/current-task'), 'T2');
    const payload = JSON.stringify({
        hook_event_name: 'PostToolUse', tool_name: 'Bash',
        tool_input: { command: 'npm test' }, tool_response: { exitCode: 0 }
    });
    runHandler(root, ['--adapter=claude-code'], payload);

    const [event] = readEvents(root);
    assert.strictEqual(event.exitCode, 0);
    assert.strictEqual(event.taskId, 'T2');
});

test('missing --adapter fails loudly (exit 2) instead of silently skipping', () => {
    const root = tempRepo();
    const error = runHandlerExpectFailure(root, [], '{}');
    assert.strictEqual(error.status, 2);
    assert.match(error.stderr, /--adapter is required/);
});

test('an unknown adapter fails open: allows the action through (exit 0) rather than blocking every tool call', () => {
    const root = tempRepo();
    const result = spawnSync(process.execPath, [HANDLER, '--adapter=does-not-exist'], { cwd: root, input: '{}', encoding: 'utf8' });
    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /allowing the action through/i);
    assert.strictEqual(readEvents(root).length, 0);
});
