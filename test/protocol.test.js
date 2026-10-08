const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { tempDir, tempRepo, git, writeFiles, AUDITKIT, NEEDS_AUDITKIT } = require('./helpers');

// The Auditor-Executor protocol is an external dependency: sdd-init and the gate take the
// skill and the Rigor documents from the installed auditkit.
const FRAMEWORK_ROOT = path.resolve(__dirname, '..');
const INIT = path.join(FRAMEWORK_ROOT, 'scripts/sdd-init.js');

function init(cwd, ...flags) {
    return execFileSync(process.execPath, [INIT, '--express', ...flags], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
}

const missingAuditkit = () => ({ ...process.env, SDD_AUDITKIT: path.join(tempDir(), 'missing-auditkit') });

function initWithoutAuditkit(cwd, ...flags) {
    return spawnSync(process.execPath, [INIT, '--express', ...flags], { cwd, encoding: 'utf8', env: missingAuditkit() });
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

test('the protocol skill comes from the installed auditkit, never from the framework checkout', NEEDS_AUDITKIT, () => {
    const project = tempRepo();
    // A stale reference file, as an older auditkit or a hand edit would leave it.
    writeFiles(project, { '.agents/skills/auditor-executor-protocol/references/dropped-upstream.md': 'old\n' });
    const output = init(tempDir(), `--target=${project}`);

    const expected = tempDir();
    execFileSync(AUDITKIT, ['install-skill', '--dest', `${expected}/`], { stdio: 'pipe' });
    const skill = '.agents/skills/auditor-executor-protocol';
    assert.strictEqual(read(project, `${skill}/SKILL.md`), fs.readFileSync(path.join(expected, 'SKILL.md'), 'utf8'));
    assert.deepStrictEqual(fs.readdirSync(path.join(project, skill, 'references')).sort(),
        fs.readdirSync(path.join(expected, 'references')).sort());
    assert.ok(exists(project, '.claude/skills/auditor-executor-protocol/SKILL.md'));
    assert.match(output, /auditor-executor-protocol \(auditkit \d+\.\d+\.\d+\)/);
    // The framework repository ships no copy of the protocol.
    assert.ok(!exists(FRAMEWORK_ROOT, 'docs/roadmap/templates'));
    assert.strictEqual(git(FRAMEWORK_ROOT, 'ls-files', '--', `${skill}/`, '.claude/skills/auditor-executor-protocol').trim(), '');
});


test('every gate run brings the untracked protocol skill back to the installed auditkit', NEEDS_AUDITKIT, () => {
    const project = tempRepo();
    init(tempDir(), `--target=${project}`);
    const skill = path.join(project, '.agents/skills/auditor-executor-protocol');
    const original = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
    assert.match(read(project, '.gitignore'), /^\.agents\/skills\/auditor-executor-protocol\/$/m);
    git(project, 'add', '-A');
    assert.strictEqual(git(project, 'ls-files', '--', '.agents/skills/auditor-executor-protocol/').trim(), '', 'skill is not committed');

    // As after a `pipx upgrade`: the project's copy no longer matches the installed auditkit.
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'older protocol\n');
    fs.writeFileSync(path.join(skill, 'references/dropped-upstream.md'), 'old\n');
    const gate = () => execFileSync(process.execPath, ['.sdd/scripts/quality-gate.js'], { cwd: project, encoding: 'utf8' });
    assert.match(gate(), /🔄 \.agents\/skills\/auditor-executor-protocol\/ updated to the protocol in auditkit \d+\.\d+\.\d+/);
    assert.strictEqual(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), original);
    assert.ok(!fs.existsSync(path.join(skill, 'references/dropped-upstream.md')));
    assert.match(gate(), /✅ \.agents\/skills\/auditor-executor-protocol\/ matches auditkit/);
});


test('the gate leaves a protocol skill that is still tracked by git untouched', NEEDS_AUDITKIT, () => {
    const project = tempRepo();
    init(tempDir(), `--target=${project}`);
    const skillFile = path.join(project, '.agents/skills/auditor-executor-protocol/SKILL.md');
    fs.writeFileSync(skillFile, 'committed by an older framework version\n');
    git(project, 'add', '-A');
    git(project, 'add', '-f', '.agents/skills/auditor-executor-protocol/SKILL.md');
    const output = execFileSync(process.execPath, ['.sdd/scripts/quality-gate.js'], { cwd: project, encoding: 'utf8' });
    assert.match(output, /is tracked by git, so it is not updated automatically\. Untrack it once with: git rm -r --cached/);
    assert.strictEqual(fs.readFileSync(skillFile, 'utf8'), 'committed by an older framework version\n');
});


test('without auditkit the gate reports the unsynced skill and still passes in Lite mode', () => {
    const project = tempRepo();
    assert.strictEqual(initWithoutAuditkit(project).status, 0);
    git(project, 'add', '-A');
    const result = spawnSync(process.execPath, ['.sdd/scripts/quality-gate.js'], {
        cwd: project, encoding: 'utf8', env: missingAuditkit()
    });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /not synced: auditkit is not installed\. Install it with: pipx install auditor-executor-protocol/);
});


test('Rigor documents are scaffolded by auditkit init and pass its lint', NEEDS_AUDITKIT, () => {
    const project = tempRepo();
    init(project, '--name=shop', '--mode=rigor');
    const expected = tempDir();
    execFileSync(AUDITKIT, ['init', expected, '--name', 'shop'], { stdio: 'pipe' });
    for (const doc of ['plan-of-record.md', 'execution-guide.md', 'compliance-log.md']) {
        assert.strictEqual(read(project, `docs/roadmap/${doc}`), fs.readFileSync(path.join(expected, doc), 'utf8'), doc);
    }
    git(project, 'add', '-A');
    execFileSync(process.execPath, ['.sdd/scripts/quality-gate.js'], { cwd: project, stdio: 'pipe' });
});


test('Rigor mode without auditkit stops before writing anything and says how to install it', () => {
    const project = tempRepo();
    const result = initWithoutAuditkit(project, '--mode=rigor');
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Rigor mode needs the Auditor-Executor protocol's CLI\. auditkit is not installed\. Install it with: pipx install auditor-executor-protocol/);
    assert.deepStrictEqual(fs.readdirSync(project).filter(f => f !== '.git'), []);
});


test('Lite mode without auditkit still provisions and reports the missing protocol skill', () => {
    const project = tempRepo();
    const result = initWithoutAuditkit(project);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(exists(project, 'docs/SPEC.md'));
    assert.ok(!exists(project, '.agents/skills/auditor-executor-protocol'));
    assert.match(result.stdout, /auditor-executor-protocol skill was not installed\. auditkit is not installed\. Install it with: pipx install auditor-executor-protocol/);
});
