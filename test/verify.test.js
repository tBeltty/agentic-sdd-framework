const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { parseSpec } = require('../scripts/lib/spec');
const { lintLiteSpec, run: checkSpec } = require('../scripts/check-spec');
const { matchExpected, parseArgs, verify, recordTask } = require('../scripts/sdd-verify');
const { tempDir, tempRepo, git, writeFiles } = require('./helpers');
const { TEMPLATE, NODE, spec, liteProject, quiet, completedSpec } = require('./spec-fixtures');

const lint = (text, options) => lintLiteSpec(text, options).problems;

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

test('F54: a PASS recorded and committed with the spec passes the gate', async () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    assert.strictEqual(checkSpec({ root: repo }).ok, false);
    assert.strictEqual((await verify({ root: repo, record: true, log: quiet, date: '2026-09-25' })).pass, true);
    assert.strictEqual(checkSpec({ root: repo }).ok, true, 'uncommitted spec: compared with the working tree');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'complete');
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
    assert.strictEqual(checkSpec({ root: repo, source: { kind: 'ref', ref: 'HEAD' } }).ok, true);
});

test('F54: files changed after sdd-verify and committed with the spec invalidate the PASS', async () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    await verify({ root: repo, record: true, log: quiet, date: '2026-09-25' });
    writeFiles(repo, { 'src/app.txt': 'v2, never verified\n' });
    assert.match(checkSpec({ root: repo }).report, /does not match the content/);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'complete with unverified change');
    assert.match(checkSpec({ root: repo }).report, /does not match the content/);
    assert.match(checkSpec({ root: repo, source: { kind: 'ref', ref: 'HEAD' } }).report, /does not match the content/);
});

test('F54: a later commit that does not touch the spec does not reopen it', async () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    await verify({ root: repo, record: true, log: quiet, date: '2026-09-25' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'complete');
    writeFiles(repo, { 'src/app.txt': 'v2, next feature\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'next feature');
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
});

test('sdd-verify fails when the command modifies tracked files', async () => {
    const repo = liteProject(completedSpec(`${NODE} -e "require('fs').writeFileSync('src/app.txt','changed');console.log('ok')"`));
    const result = await verify({ root: repo, record: true, log: quiet, date: '2026-09-25' });
    assert.strictEqual(result.modified, true);
    assert.strictEqual(result.pass, false);
    assert.match(fs.readFileSync(path.join(repo, 'docs/SPEC.md'), 'utf8'), /Last Verified:\*\* 2026-09-25 FAIL/);
});

test('sdd-verify fails on a non-zero exit or missing expected output', async () => {
    assert.strictEqual((await verify({ root: liteProject(completedSpec(`${NODE} -e "process.exit(3)"`)), log: quiet })).exitCode, '3');
    assert.deepStrictEqual((await verify({ root: liteProject(completedSpec(`${NODE} -e "console.log('nope')"`)), log: quiet })).missing, ['ok']);
});

test('F57: sdd-verify enforces specification.verifyTimeoutSeconds', async () => {
    const repo = liteProject(completedSpec(`${NODE} -e "setTimeout(() => {}, 6000)"`), { verifyTimeoutSeconds: 1 });
    assert.strictEqual((await verify({ root: repo, log: quiet })).exitCode, 'timeout');
});

test('N6: sdd-verify --record refuses to run with untracked files', async () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    writeFiles(repo, { 'src/helper.txt': 'never committed\n' });
    const before = fs.readFileSync(path.join(repo, 'docs/SPEC.md'), 'utf8');
    await assert.rejects(() => verify({ root: repo, record: true, log: quiet }), /Untracked files[\s\S]*src\/helper\.txt/);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'docs/SPEC.md'), 'utf8'), before, 'nothing is recorded');
    assert.strictEqual((await verify({ root: repo, log: quiet })).pass, true, 'a plain run still works');
});

test('F57: on timeout the whole process tree is killed, not only the shell', async () => {
    const repo = liteProject(completedSpec(`${NODE} slow.js`), { verifyTimeoutSeconds: 1 });
    writeFiles(repo, {
        'slow.js': "require('child_process').spawn(process.execPath, ['-e', \"setTimeout(() => require('fs').writeFileSync('late.txt', 'x'), 2500)\"], { stdio: 'ignore' });\nsetTimeout(() => {}, 10000);\n"
    });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'slow');
    assert.strictEqual((await verify({ root: repo, log: quiet })).exitCode, 'timeout');
    await new Promise(resolve => setTimeout(resolve, 3500));
    assert.ok(!fs.existsSync(path.join(repo, 'late.txt')), 'the grandchild process kept running after the timeout');
});

test('R1: a verification command hidden in an HTML comment is never run or recorded', async () => {
    const base = completedSpec(`${NODE} -e "console.log('ok')"`);
    const hiddenFence = '<!--\n  ```sh\n  echo ok\n  ```\n-->\n';
    const text = base.replace('* **Verification Command:**\n', `* **Verification Command:**\n${hiddenFence}`);
    assert.notStrictEqual(text, base, 'fixture must insert the hidden fence');
    assert.strictEqual(parseSpec(text).gate.command, `${NODE} -e "console.log('ok')"`);
    assert.match(lint(text).join(), /HTML comment holds spec structure/);
    const repo = liteProject(text);
    await assert.rejects(() => verify({ root: repo, record: true, log: quiet }), /HTML comment holds spec structure/);
});

test('R2: an inline "<!--" (code span or prose) hides nothing', () => {
    const text = spec({ status: 'Completed', checked: ['T1', 'T3'], evidence: { T1: "`grep -c '<!--' tpl.md` printed 3", T3: 'x' } })
        .replace('**T3:**', '**T3:** Document `parse --> render`');
    const tasks = parseSpec(text).tasks;
    assert.deepStrictEqual(tasks.map(t => [t.id, t.checked]), [['T1', true], ['T2', false], ['T3', true]]);
    assert.match(lint(text).join(), /T2 is not checked/);
});

test('R2: an unterminated comment block that hides tasks fails instead of passing', () => {
    const text = spec({ status: 'Draft' }).replace('* [ ] **T2:**', '<!-- start\n* [ ] **T2:**');
    assert.match(lint(text).join(), /HTML comment holds spec structure/);
});

test('sdd-verify --task records real output as evidence and checks the box', async () => {
    const repo = liteProject(spec({ status: 'In Progress' }));
    assert.strictEqual((await recordTask({ root: repo, taskId: 'T2', command: `${NODE} -e "console.log('2 passed')"`, log: quiet, date: '2026-09-25' })).exitCode, '0');
    const task = parseSpec(fs.readFileSync(path.join(repo, 'docs/SPEC.md'), 'utf8')).tasks.find(t => t.id === 'T2');
    assert.strictEqual(task.checked, true);
    assert.strictEqual(task.evidence.recorded.intact, true);
    assert.match(task.evidence.text, /2 passed/);
    await assert.rejects(() => recordTask({ root: repo, taskId: 'T9', command: 'echo', log: quiet }), /Task T9 not found/);
});

test('sdd-verify refuses placeholder commands', async () => {
    await assert.rejects(() => verify({ root: liteProject(TEMPLATE), log: quiet }), /verification command is still a placeholder/);
});

test('a missing lite spec fails the gate; the framework repository is exempt', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ specification: { mode: 'lite' } }) });
    git(repo, 'add', '-A');
    assert.match(checkSpec({ root: repo }).report, /docs\/SPEC\.md not found/);
    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ project: { type: 'framework' } }) });
    assert.strictEqual(checkSpec({ root: repo }).ok, false, 'N8: project.type alone does not exempt a project');
    writeFiles(repo, { 'package.json': JSON.stringify({ name: 'agentic-sdd-framework' }) });
    assert.strictEqual(checkSpec({ root: repo }).ok, true);
});

test('R10: in a shallow clone the spec check explains how to fetch the history', () => {
    const repo = liteProject(completedSpec(`${NODE} -e "console.log('ok')"`));
    return verify({ root: repo, record: true, log: quiet, date: '2026-09-25' }).then(() => {
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'complete');
        writeFiles(repo, { 'src/app.txt': 'v2\n' });
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'next');
        assert.strictEqual(checkSpec({ root: repo }).ok, true, 'full clone');
        const shallow = path.join(tempDir(), 'shallow');
        git(repo, 'clone', '-q', '--depth', '1', pathToFileURL(repo).href, shallow);
        assert.strictEqual(git(shallow, 'rev-parse', '--is-shallow-repository').trim(), 'true', 'fixture must be a shallow clone');
        assert.throws(() => checkSpec({ root: shallow }), /shallow clone[\s\S]*fetch-depth: 0/);
    });
});
