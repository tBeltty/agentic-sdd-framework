const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./helpers');
const { appendEvent, readEvents, sessionLogPath, readCurrentTask, matchesKillCommand } = require('../scripts/lib/session-log');

test('appendEvent/readEvents round-trip, one JSON object per line', () => {
    const root = tempDir();
    appendEvent(root, { ts: '2026-01-01T00:00:00.000Z', agent: 'claude-code', event: 'pre', tool: 'Bash', command: 'npm test' });
    appendEvent(root, { ts: '2026-01-01T00:00:01.000Z', agent: 'claude-code', event: 'post', tool: 'Bash', exitCode: 0 });

    const events = readEvents(root);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].command, 'npm test');
    assert.strictEqual(events[1].exitCode, 0);
    assert.ok(fs.existsSync(sessionLogPath(root)));
});

test('readEvents returns an empty array when the log does not exist yet', () => {
    assert.deepStrictEqual(readEvents(tempDir()), []);
});

test('appendEvent rejects an event missing a required field', () => {
    const root = tempDir();
    assert.throws(() => appendEvent(root, { ts: 'x', agent: 'a', tool: 'Bash' }), /event\.event/);
    assert.throws(() => appendEvent(root, { ts: 'x', agent: 'a', event: 'sideways', tool: 'Bash' }), /"pre" or "post"/);
});

test('readCurrentTask reads the optional marker file, or returns null', () => {
    const root = tempDir();
    assert.strictEqual(readCurrentTask(root), null);
    fs.mkdirSync(path.join(root, '.sdd'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sdd/current-task'), 'T3\n');
    assert.strictEqual(readCurrentTask(root), 'T3');
});

test('matchesKillCommand catches kill/pkill/killall as their own command word', () => {
    for (const command of ['kill 1234', 'pkill -f server', 'killall node', 'npm start && kill $PID', 'kill -9 1234; echo done']) {
        assert.ok(matchesKillCommand(command), `expected a match for: ${command}`);
    }
});

test('matchesKillCommand does not flag "kill" appearing as someone else\'s argument or substring', () => {
    for (const command of ['grep kill server.log', 'echo killer', 'npm run killtask', 'cat /tmp/kill-notes.txt', '']) {
        assert.ok(!matchesKillCommand(command), `expected no match for: ${command}`);
    }
    assert.strictEqual(matchesKillCommand(undefined), false);
    assert.strictEqual(matchesKillCommand(null), false);
});
