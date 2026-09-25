const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseSpec, withLastVerified } = require('../scripts/lib/spec');
const { lintLiteSpec, run: checkSpec } = require('../scripts/check-spec');
const { matchExpected, verify } = require('../scripts/sdd-verify');
const { tempRepo, git, writeFiles } = require('./helpers');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../docs/SPEC_TEMPLATE.md'), 'utf8');

// Builds a spec from the real template so the tests track its format.
function spec({ status, tasks, command = 'npm test', expected = '3 passed', lastVerified }) {
    let text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed', `**Status:** ${status}`);
    text = text.replace('[command to run tests or validation scripts]', command);
    text = text.replace('[exact pattern or output line confirming success]', expected);
    if (lastVerified) text = text.replace('[recorded by sdd-verify --record]', lastVerified);
    for (const [id, { checked, evidence }] of Object.entries(tasks || {})) {
        const n = id.slice(1);
        if (checked) text = text.replace(`* [ ] **T${n}:**`, `* [x] **T${n}:**`);
        if (evidence) {
            const marker = '  * **Evidence:** [command run and its literal output]';
            const at = text.indexOf(marker, text.indexOf(`**T${n}:**`));
            text = text.slice(0, at) + `  * **Evidence:** ${evidence}` + text.slice(at + marker.length);
        }
    }
    return text;
}

const lint = text => lintLiteSpec(text).problems;

test('the untouched template parses as a draft with placeholders only', () => {
    const parsed = parseSpec(TEMPLATE);
    assert.strictEqual(parsed.status, null);
    assert.deepStrictEqual(parsed.tasks.map(t => [t.id, t.checked, t.evidence]), [['T1', false, ''], ['T2', false, ''], ['T3', false, '']]);
    assert.deepStrictEqual(parsed.gate, { command: '', expected: '', lastVerified: '' });
    assert.deepStrictEqual(lint(TEMPLATE), []);
});

test('a checked task without evidence fails, even in a draft', () => {
    const problems = lint(spec({ status: 'Draft', tasks: { T1: { checked: true } } }));
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /T1 is checked but has no evidence/);
});

test('evidence can be multi-line with a fenced block', () => {
    const text = spec({ status: 'Draft', tasks: { T1: { checked: true } } }).replace(
        '  * **Evidence:** [command run and its literal output]',
        '  * **Evidence:**\n    ```text\n    $ npm test\n    3 passed\n    ```'
    );
    assert.strictEqual(parseSpec(text).tasks[0].evidence, '$ npm test\n3 passed');
    assert.deepStrictEqual(lint(text), []);
});

test('in progress requires a real command and expected output', () => {
    const text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed', '**Status:** In Progress');
    const problems = lint(text);
    assert.strictEqual(problems.length, 2);
    assert.match(problems.join('\n'), /command is still a placeholder[\s\S]*expected output is still a placeholder/);
});

test('completed requires every task checked and a recorded PASS', () => {
    const problems = lint(spec({ status: 'Completed', tasks: { T1: { checked: true, evidence: '`npm test` -> ok' } } }));
    assert.match(problems.join('\n'), /T2 is not checked/);
    assert.match(problems.join('\n'), /T3 is not checked/);
    assert.match(problems.join('\n'), /no PASS/);

    const all = { checked: true, evidence: '`npm test` -> 3 passed' };
    const done = spec({ status: 'Completed', tasks: { T1: all, T2: all, T3: all }, lastVerified: '2026-09-25 PASS (commit abc1234, exit 0)' });
    assert.deepStrictEqual(lint(done), []);
});

test('bracketed shell tests are commands, not placeholders; fenced indentation is kept', () => {
    const text = spec({ status: 'In Progress', command: '[ -f dist/app ] && ./run.sh\n  if true; then\n    echo nested\n  fi' });
    assert.strictEqual(parseSpec(text).gate.command, '[ -f dist/app ] && ./run.sh\nif true; then\n  echo nested\nfi');
});

test('expected output lines match as substrings or /regex/', () => {
    assert.deepStrictEqual(matchExpected('3 passed\n/in \\d+ms/', 'Tests: 3 passed in 42ms'), []);
    assert.deepStrictEqual(matchExpected('4 passed', 'Tests: 3 passed'), ['4 passed']);
});

test('withLastVerified replaces the existing entry', () => {
    const once = withLastVerified(TEMPLATE, '2026-09-25 FAIL (commit a, exit 1)');
    const twice = withLastVerified(once, '2026-09-26 PASS (commit b, exit 0)');
    assert.strictEqual((twice.match(/\*\*Last Verified:\*\*/g) || []).length, 1);
    assert.strictEqual(parseSpec(twice).gate.lastVerified, '2026-09-26 PASS (commit b, exit 0)');
});

function liteProject(specText) {
    const repo = tempRepo();
    writeFiles(repo, {
        'sdd.config.json': JSON.stringify({ project: { type: 'application' }, specification: { mode: 'lite' } }),
        'docs/SPEC.md': specText
    });
    git(repo, 'add', '-A');
    return repo;
}

test('sdd-verify runs the gate, records PASS, and the completed spec then passes the gate', () => {
    const all = { checked: true, evidence: '`node -e ...` -> ok' };
    const repo = liteProject(spec({
        status: 'Completed',
        tasks: { T1: all, T2: all, T3: all },
        command: 'node -e "console.log(\'3 passed in 12ms\')"',
        expected: '3 passed\n/in \\d+ms/'
    }));
    assert.strictEqual(checkSpec({ root: repo }).ok, false);

    const result = verify({ root: repo, record: true, log: () => {}, date: '2026-09-25' });
    assert.strictEqual(result.pass, true);
    assert.match(fs.readFileSync(path.join(repo, 'docs/SPEC.md'), 'utf8'), /Last Verified:\*\* 2026-09-25 PASS \(commit no-commit, exit 0\)/);
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
});

test('sdd-verify fails on a non-zero exit or missing expected output, and records FAIL', () => {
    const exits = liteProject(spec({ status: 'In Progress', command: 'node -e "process.exit(3)"', expected: 'ok' }));
    assert.strictEqual(verify({ root: exits, log: () => {} }).exitCode, 3);

    const wrong = liteProject(spec({ status: 'In Progress', command: 'echo nope', expected: 'ok' }));
    const result = verify({ root: wrong, record: true, log: () => {}, date: '2026-09-25' });
    assert.deepStrictEqual(result.missing, ['ok']);
    assert.match(fs.readFileSync(path.join(wrong, 'docs/SPEC.md'), 'utf8'), /2026-09-25 FAIL/);
});

test('sdd-verify refuses placeholder commands', () => {
    const repo = liteProject(TEMPLATE);
    assert.throws(() => verify({ root: repo, log: () => {} }), /verification command is still a placeholder/);
});

test('a missing lite spec fails the gate; the framework repository is exempt', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ specification: { mode: 'lite' } }) });
    assert.match(checkSpec({ root: repo }).report, /docs\/SPEC\.md not found/);
    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ project: { type: 'framework' } }) });
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
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
    return repo;
}

test('rigor mode reports a missing auditkit with install instructions', () => {
    const previous = process.env.SDD_AUDITKIT;
    process.env.SDD_AUDITKIT = '/nonexistent/auditkit';
    try {
        const result = checkSpec({ root: rigorProject() });
        assert.strictEqual(result.ok, false);
        assert.match(result.report, /pipx install git\+https:\/\/github\.com\/tBeltty\/auditor-executor-protocol/);
    } finally {
        if (previous === undefined) delete process.env.SDD_AUDITKIT; else process.env.SDD_AUDITKIT = previous;
    }
});

test('rigor mode passes fresh templates and rejects DONE without evidence', { skip: !hasAuditkit && 'auditkit not installed' }, () => {
    assert.strictEqual(checkSpec({ root: rigorProject() }).ok, true);

    const templates = path.join(__dirname, '../docs/roadmap/templates');
    const log = fs.readFileSync(path.join(templates, 'compliance-log.md'), 'utf8').replace('### P0-T1 — PENDING', '### P0-T1 — DONE');
    const result = checkSpec({ root: rigorProject(log) });
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /done without evidence/);
});
