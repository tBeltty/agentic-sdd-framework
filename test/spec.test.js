const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseSpec, withLastVerified, withTaskEvidence } = require('../scripts/lib/spec');
const { lintLiteSpec, parseVersion, versionAtLeast, MIN_AUDITKIT, run: checkSpec } = require('../scripts/check-spec');
const { matchExpected, parseArgs, verify, recordTask } = require('../scripts/sdd-verify');
const { tempRepo, git, writeFiles } = require('./helpers');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../docs/SPEC_TEMPLATE.md'), 'utf8');
const NODE = JSON.stringify(process.execPath);

// Builds a spec from the real template so the tests track its format.
function spec({ status, checked = [], evidence = {}, command = 'npm test', expected = '3 passed', lastVerified }) {
    let text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed', `**Status:** ${status}`);
    text = text.replace('[command to run tests or validation scripts]', command);
    text = text.replace('[exact pattern or output line confirming success]', expected);
    if (lastVerified) text = text.replace('[recorded by sdd-verify --record]', lastVerified);
    for (const id of checked) text = text.replace(`* [ ] **${id}:**`, `* [x] **${id}:**`);
    for (const [id, value] of Object.entries(evidence)) {
        const marker = '  * **Evidence:** [command run and its literal output]';
        const at = text.indexOf(marker, text.indexOf(`**${id}:**`));
        text = text.slice(0, at) + `  * **Evidence:** ${value}` + text.slice(at + marker.length);
    }
    return text;
}
const ALL = ['T1', 'T2', 'T3'];
const lint = (text, options) => lintLiteSpec(text, options).problems;

test('the untouched template parses as a draft with placeholders only', () => {
    const parsed = parseSpec(TEMPLATE);
    assert.strictEqual(parsed.status, null);
    assert.strictEqual(parsed.statusProblem, null);
    assert.deepStrictEqual(parsed.tasks.map(t => [t.id, t.checked, t.evidence.text]), [['T1', false, ''], ['T2', false, ''], ['T3', false, '']]);
    assert.deepStrictEqual([parsed.gate.command, parsed.gate.expected, parsed.gate.lastVerified], ['', '', '']);
    assert.deepStrictEqual(lint(TEMPLATE), []);
});

test('a checked task without evidence fails, even in a draft', () => {
    assert.match(lint(spec({ status: 'Draft', checked: ['T1'] })).join(), /T1 is checked but has no evidence/);
});

test('F50: CRLF specs are parsed like LF specs', () => {
    const crlf = spec({ status: 'Draft', checked: ['T1'] }).replace(/\n/g, '\r\n');
    assert.strictEqual(parseSpec(crlf).tasks.length, 3);
    assert.match(lint(crlf).join(), /T1 is checked but has no evidence/);
});

test('F51: an unknown status is an error, not a silent draft', () => {
    assert.match(lint(spec({ status: 'Done' })).join(), /Unknown status "Done"/);
    assert.match(lint(TEMPLATE.replace(/\*\*Status:\*\*.*\n/, '')).join(), /No "\*\*Status:\*\*" line/);
});

test('F52: checkbox tasks in any list format are checked', () => {
    const text = TEMPLATE + '\n## 6. More\n\n* [x] Deploy to production\n1. [x] Run the migration\n- [X] **T9:** Rotate keys\n';
    const problems = lint(text).join('\n');
    assert.match(problems, /line \d+ is checked but has no evidence/);
    assert.match(problems, /T9 is checked but has no evidence/);
    assert.strictEqual((problems.match(/has no evidence/g) || []).length, 3);
});

test('evidence can be multi-line with a fenced block; fences inside tasks do not end the task', () => {
    const text = spec({ status: 'Draft', checked: ['T1'] }).replace(
        '  * **Evidence:** [command run and its literal output]',
        '  * **Evidence:**\n    ```text\n    $ npm test\n\n    3 passed\n    ```'
    );
    assert.strictEqual(parseSpec(text).tasks[0].evidence.text, '$ npm test\n3 passed');
    assert.deepStrictEqual(lint(text), []);
});

test('in progress requires a real command and expected output', () => {
    const problems = lint(TEMPLATE.replace('**Status:** Draft | In Progress | Completed', '**Status:** In Progress'));
    assert.strictEqual(problems.length, 2);
});

test('F53: a hand-written Last Verified is rejected even if it says PASS', () => {
    for (const value of ['PASS', 'FAIL, will PASS later', '2026-09-25 PASS (commit abc1234, exit 0)']) {
        const text = spec({ status: 'Completed', checked: ALL, evidence: { T1: 'x', T2: 'x', T3: 'x' }, lastVerified: value });
        assert.match(lint(text).join(), /not written by sdd-verify --record/, value);
    }
});

test('completed requires every task checked, and a PASS matching the expected state', () => {
    const state = '0123456789abcdef';
    const done = spec({ status: 'Completed', checked: ALL, evidence: { T1: 'x', T2: 'x', T3: 'x' }, lastVerified: `2026-09-25 PASS (commit abc1234, exit 0, state ${state})` });
    assert.deepStrictEqual(lint(done, { expectedState: state }), []);
    assert.match(lint(done, { expectedState: 'fedcba9876543210' }).join(), /does not match the content/);
    const failed = done.replace('PASS (commit', 'FAIL (commit').replace('exit 0,', 'exit 1,');
    assert.match(lint(failed, { expectedState: state }).join(), /last verification is FAIL/);
    assert.match(lint(spec({ status: 'Completed', checked: ['T1'], evidence: { T1: 'x' } })).join(), /T2 is not checked/);
});

test('F55: recorded evidence is verified; tampering and failures are rejected; manual evidence is counted', () => {
    const recorded = withTaskEvidence(spec({ status: 'Draft' }), 'T1', { date: '2026-09-25', exit: '0', transcript: '$ npm test\n3 passed' });
    assert.strictEqual(parseSpec(recorded).tasks[0].checked, true);
    assert.strictEqual(parseSpec(recorded).tasks[0].evidence.recorded.intact, true);
    assert.deepStrictEqual(lint(recorded), []);

    assert.match(lint(recorded.replace('3 passed', '4 passed')).join(), /edited after sdd-verify wrote it/);
    const failing = withTaskEvidence(spec({ status: 'Draft' }), 'T1', { date: '2026-09-25', exit: '1', transcript: '$ npm test\n1 failed' });
    assert.match(lint(failing).join(), /exit 1, not 0/);

    const manual = spec({ status: 'Draft', checked: ['T1'], evidence: { T1: 'ran npm test: ok' } });
    assert.deepStrictEqual(lint(manual), []);
    assert.match(lintLiteSpec(manual).notes.join(), /1 checked task\(s\) have hand-written evidence/);
    assert.match(lint(manual, { requireRecordedEvidence: true }).join(), /evidence is hand-written/);
});

test('F58: writers preserve CRLF line endings', () => {
    const crlf = TEMPLATE.replace(/\n/g, '\r\n');
    const out = withLastVerified(withTaskEvidence(crlf, 'T2', { date: '2026-09-25', exit: '0', transcript: 'ok' }), 'x');
    assert.ok(!/[^\r]\n/.test(out), 'every newline must stay CRLF');
});

test('bracketed shell tests are commands, not placeholders; fenced indentation is kept', () => {
    const text = spec({ status: 'In Progress', command: '[ -f dist/app ] && ./run.sh\n  if true; then\n    echo nested\n  fi' });
    assert.strictEqual(parseSpec(text).gate.command, '[ -f dist/app ] && ./run.sh\nif true; then\n  echo nested\nfi');
});

test('expected output lines match as substrings or /regex/', () => {
    assert.deepStrictEqual(matchExpected('3 passed\n/in \\d+ms/', 'Tests: 3 passed in 42ms'), []);
    assert.deepStrictEqual(matchExpected('4 passed', 'Tests: 3 passed'), ['4 passed']);
});

test('sdd-verify rejects unknown arguments and malformed --task usage', () => {
    assert.throws(() => parseArgs(['--recrod']), /Unknown argument "--recrod"/);
    assert.throws(() => parseArgs(['--task', 'T1']), /needs a command/);
    assert.throws(() => parseArgs(['--', 'echo']), /only used with --task/);
    assert.deepStrictEqual(parseArgs(['--task=T1', '--', 'npm', 'test']).command, 'npm test');
});

function liteProject(specText, config = {}) {
    const repo = tempRepo();
    writeFiles(repo, {
        'sdd.config.json': JSON.stringify({ project: { type: 'application' }, specification: { mode: 'lite', ...config } }),
        'docs/SPEC.md': specText,
        'src/app.txt': 'v1\n'
    });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    return repo;
}
const quiet = () => {};
const completedSpec = (command, expected = 'ok') =>
    spec({ status: 'Completed', checked: ALL, evidence: { T1: 'x', T2: 'x', T3: 'x' }, command, expected });

test('F54: a PASS recorded and committed with the spec passes the gate', () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    assert.strictEqual(checkSpec({ root: repo }).ok, false);
    assert.strictEqual(verify({ root: repo, record: true, log: quiet, date: '2026-09-25' }).pass, true);
    assert.strictEqual(checkSpec({ root: repo }).ok, true, 'uncommitted spec: compared with the working tree');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'complete');
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
    assert.strictEqual(checkSpec({ root: repo, source: { kind: 'ref', ref: 'HEAD' } }).ok, true);
});

test('F54: files changed after sdd-verify and committed with the spec invalidate the PASS', () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    verify({ root: repo, record: true, log: quiet, date: '2026-09-25' });
    writeFiles(repo, { 'src/app.txt': 'v2, never verified\n' });
    assert.match(checkSpec({ root: repo }).report, /does not match the content/);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'complete with unverified change');
    assert.match(checkSpec({ root: repo }).report, /does not match the content/);
    assert.match(checkSpec({ root: repo, source: { kind: 'ref', ref: 'HEAD' } }).report, /does not match the content/);
});

test('F54: a later commit that does not touch the spec does not reopen it', () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    verify({ root: repo, record: true, log: quiet, date: '2026-09-25' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'complete');
    writeFiles(repo, { 'src/app.txt': 'v2, next feature\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'next feature');
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
});

test('sdd-verify fails when the command modifies tracked files', () => {
    const repo = liteProject(completedSpec(`${NODE} -e "require('fs').writeFileSync('src/app.txt','changed');console.log('ok')"`));
    const result = verify({ root: repo, record: true, log: quiet, date: '2026-09-25' });
    assert.strictEqual(result.modified, true);
    assert.strictEqual(result.pass, false);
    assert.match(fs.readFileSync(path.join(repo, 'docs/SPEC.md'), 'utf8'), /Last Verified:\*\* 2026-09-25 FAIL/);
});

test('sdd-verify fails on a non-zero exit or missing expected output', () => {
    assert.strictEqual(verify({ root: liteProject(completedSpec(`${NODE} -e "process.exit(3)"`)), log: quiet }).exitCode, '3');
    assert.deepStrictEqual(verify({ root: liteProject(completedSpec(`${NODE} -e "console.log('nope')"`)), log: quiet }).missing, ['ok']);
});

test('F57: sdd-verify enforces specification.verifyTimeoutSeconds', () => {
    const repo = liteProject(completedSpec(`${NODE} -e "setTimeout(() => {}, 6000)"`), { verifyTimeoutSeconds: 1 });
    assert.strictEqual(verify({ root: repo, log: quiet }).exitCode, 'timeout');
});

test('sdd-verify --task records real output as evidence and checks the box', () => {
    const repo = liteProject(spec({ status: 'In Progress' }));
    assert.strictEqual(recordTask({ root: repo, taskId: 'T2', command: `${NODE} -e "console.log('2 passed')"`, log: quiet, date: '2026-09-25' }).exitCode, '0');
    const task = parseSpec(fs.readFileSync(path.join(repo, 'docs/SPEC.md'), 'utf8')).tasks.find(t => t.id === 'T2');
    assert.strictEqual(task.checked, true);
    assert.strictEqual(task.evidence.recorded.intact, true);
    assert.match(task.evidence.text, /2 passed/);
    assert.throws(() => recordTask({ root: repo, taskId: 'T9', command: 'echo', log: quiet }), /Task T9 not found/);
});

test('sdd-verify refuses placeholder commands', () => {
    assert.throws(() => verify({ root: liteProject(TEMPLATE), log: quiet }), /verification command is still a placeholder/);
});

test('a missing lite spec fails the gate; the framework repository is exempt', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ specification: { mode: 'lite' } }) });
    git(repo, 'add', '-A');
    assert.match(checkSpec({ root: repo }).report, /docs\/SPEC\.md not found/);
    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ project: { type: 'framework' } }) });
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
});

test('F75: auditkit version comparison', () => {
    assert.deepStrictEqual(parseVersion('auditkit 0.3.0\n'), [0, 3, 0]);
    assert.strictEqual(versionAtLeast([0, 2, 9], MIN_AUDITKIT), false);
    assert.strictEqual(versionAtLeast([0, 3, 0], MIN_AUDITKIT), true);
    assert.strictEqual(versionAtLeast([1, 0, 0], MIN_AUDITKIT), true);
});

// Rigor mode delegates to auditkit. SDD_AUDITKIT points at a specific binary in tests;
// the positive cases are skipped when auditkit is not installed.
const AUDITKIT = process.env.SDD_AUDITKIT || 'auditkit';
const hasAuditkit = !spawnSync(AUDITKIT, ['--version']).error;

function rigorProject(log) {
    const repo = tempRepo();
    const templates = path.join(__dirname, '../docs/roadmap/templates');
    writeFiles(repo, {
        'sdd.config.json': JSON.stringify({ specification: { mode: 'rigor' } }),
        'docs/roadmap/plan-of-record.md': fs.readFileSync(path.join(templates, 'plan-of-record.md'), 'utf8'),
        'docs/roadmap/execution-guide.md': fs.readFileSync(path.join(templates, 'execution-guide.md'), 'utf8'),
        'docs/roadmap/compliance-log.md': log || fs.readFileSync(path.join(templates, 'compliance-log.md'), 'utf8')
    });
    git(repo, 'add', '-A');
    return repo;
}

function withAuditkit(bin, fn) {
    const previous = process.env.SDD_AUDITKIT;
    process.env.SDD_AUDITKIT = bin;
    try {
        return fn();
    } finally {
        if (previous === undefined) delete process.env.SDD_AUDITKIT; else process.env.SDD_AUDITKIT = previous;
    }
}

test('rigor mode reports a missing auditkit with install instructions', () => {
    const result = withAuditkit('/nonexistent/auditkit', () => checkSpec({ root: rigorProject() }));
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /pipx install git\+https:\/\/github\.com\/tBeltty\/auditor-executor-protocol/);
});

test('F75: rigor mode rejects an auditkit older than the minimum', { skip: process.platform === 'win32' && 'uses a shell-script stub' }, () => {
    const stub = path.join(tempRepo(), 'auditkit');
    fs.writeFileSync(stub, '#!/bin/sh\necho "auditkit 0.2.0"\n', { mode: 0o755 });
    const result = withAuditkit(stub, () => checkSpec({ root: rigorProject() }));
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /older than 0\.3\.0/);
});

test('rigor mode passes fresh templates and rejects DONE without evidence', { skip: !hasAuditkit && 'auditkit not installed' }, () => {
    assert.strictEqual(checkSpec({ root: rigorProject() }).ok, true);
    const templates = path.join(__dirname, '../docs/roadmap/templates');
    const log = fs.readFileSync(path.join(templates, 'compliance-log.md'), 'utf8').replace('### P0-T1 — PENDING', '### P0-T1 — DONE');
    const result = checkSpec({ root: rigorProject(log) });
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /done without evidence/);
});

test('F61: rigor mode lints the staged documents, not the working tree', { skip: !hasAuditkit && 'auditkit not installed' }, () => {
    const templates = path.join(__dirname, '../docs/roadmap/templates');
    const badLog = fs.readFileSync(path.join(templates, 'compliance-log.md'), 'utf8').replace('### P0-T1 — PENDING', '### P0-T1 — DONE');
    const repo = rigorProject(badLog);
    writeFiles(repo, { 'docs/roadmap/compliance-log.md': fs.readFileSync(path.join(templates, 'compliance-log.md'), 'utf8') });
    assert.strictEqual(checkSpec({ root: repo }).ok, true, 'working tree is clean');
    assert.strictEqual(checkSpec({ root: repo, source: { kind: 'index' } }).ok, false, 'index has DONE without evidence');
});
