const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { tempRepo, git, writeFiles } = require('./helpers');
const { appendEvent } = require('../scripts/lib/session-log');
const { buildReport } = require('../scripts/sdd-report');

const SPEC = `# Sample

**Status:** In Progress

## Tasks

- [x] **T1:** Parse the input
  - **Evidence:** sdd-verify 2026-01-02, exit 0, sha256 abcdef0123456789
    \`\`\`
    42 passed
    \`\`\`
- [ ] **T2:** Handle the edge case

## Verification Gate

* **Verification Command:**
  \`\`\`
  npm test
  \`\`\`
* **Expected Output:**
  \`\`\`
  passed
  \`\`\`
* **Last Verified:** (not yet)
`;

test('buildReport renders task IDs, evidence, and session-log entries into the HTML', () => {
    const root = tempRepo();
    writeFiles(root, { 'docs/SPEC.md': SPEC });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'seed spec');

    appendEvent(root, { ts: '2026-01-02T10:00:00.000Z', agent: 'claude-code', event: 'pre', tool: 'Bash', command: 'npm test', taskId: 'T1' });
    appendEvent(root, { ts: '2026-01-02T10:00:01.000Z', agent: 'claude-code', event: 'pre', tool: 'Bash', command: 'kill 999', taskId: 'T1', denied: true, reason: 'raw kill/pkill/killall command' });

    const outPath = buildReport({ root, out: 'report-out.html' });
    assert.ok(fs.existsSync(outPath));
    const html = fs.readFileSync(outPath, 'utf8');

    assert.match(html, /T1/);
    assert.match(html, /T2/);
    assert.match(html, /sdd-verify 2026-01-02, exit 0/);
    assert.match(html, /npm test/);
    assert.match(html, />denied</); // short badge label
    assert.match(html, /title="raw kill\/pkill\/killall command"/); // full reason in the tooltip, not stretched into the pill
    assert.match(html, /seed spec/);
});

test('buildReport degrades gracefully with no spec and no session log', () => {
    const root = tempRepo();
    git(root, 'commit', '-q', '--allow-empty', '-m', 'empty');

    const outPath = buildReport({ root, out: 'report-out.html' });
    const html = fs.readFileSync(outPath, 'utf8');
    assert.match(html, /No spec found/);
    assert.match(html, /No session log entries/);
    assert.match(html, /empty/);
});
