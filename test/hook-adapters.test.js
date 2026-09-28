const test = require('node:test');
const assert = require('node:assert');
const { normalize } = require('../scripts/lib/hook-adapters/claude-code');

test('claude-code adapter normalizes a PreToolUse Bash payload', () => {
    const event = normalize({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    assert.strictEqual(event.event, 'pre');
    assert.strictEqual(event.tool, 'Bash');
    assert.strictEqual(event.command, 'npm test');
    assert.strictEqual(event.agent, 'claude-code');
    assert.ok(event.ts);
});

test('claude-code adapter normalizes a PostToolUse Bash payload with an exit code', () => {
    const event = normalize({
        hook_event_name: 'PostToolUse', tool_name: 'Bash',
        tool_input: { command: 'npm test' }, tool_response: { exitCode: 1 }
    });
    assert.strictEqual(event.event, 'post');
    assert.strictEqual(event.exitCode, 1);
});

test('claude-code adapter captures filePath for Edit/Write, not command', () => {
    const event = normalize({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } });
    assert.strictEqual(event.filePath, 'src/app.js');
    assert.strictEqual(event.command, undefined);
});

test('claude-code adapter rejects an unsupported hook_event_name', () => {
    assert.throws(() => normalize({ hook_event_name: 'Notification', tool_name: 'Bash' }), /unsupported hook_event_name/);
});

test('claude-code adapter rejects an empty payload', () => {
    assert.throws(() => normalize(null), /empty or non-object/);
});
