#!/usr/bin/env node

/**
 * scripts/sdd-verify.js
 *
 * Runs the verification command declared in the Lite specification's "Verification
 * Gate" and checks it against the expected output. The run passes when the command
 * exits 0 and every non-empty expected line appears in stdout or stderr. An expected
 * line wrapped in slashes (/.../) is matched as a regular expression.
 *
 * This executes a command written in docs/SPEC.md, so it only runs when invoked
 * explicitly; the quality gate never calls it.
 *
 * Usage: node scripts/sdd-verify.js [--record]
 *   --record   write the result to the "Last Verified" line of the specification
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { git, repoRoot } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { parseSpec, withLastVerified } = require('./lib/spec');

function matchExpected(expected, output) {
    const missing = [];
    for (const raw of expected.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const regex = line.length > 2 && line.startsWith('/') && line.endsWith('/');
        const found = regex ? new RegExp(line.slice(1, -1), 'm').test(output) : output.includes(line);
        if (!found) missing.push(line);
    }
    return missing;
}

function currentCommit(root) {
    try {
        const sha = git(['rev-parse', '--short', 'HEAD'], root).trim();
        const dirty = git(['status', '--porcelain', '--untracked-files=no'], root).trim() !== '';
        return dirty ? `${sha}+uncommitted` : sha;
    } catch {
        return 'no-commit';
    }
}

function verify({ root = repoRoot(), record = false, log = console.log, date } = {}) {
    const config = loadConfig(root);
    if (getIn(config, 'specification.mode', 'lite') === 'rigor') {
        throw new Error('sdd-verify covers Lite mode. In Rigor mode, gates are run per task (see docs/roadmap/execution-guide.md) and checked with auditkit lint.');
    }
    const specFile = getIn(config, 'specification.specFile', 'docs/SPEC.md');
    const specPath = path.join(root, specFile);
    if (!fs.existsSync(specPath)) throw new Error(`${specFile} not found.`);
    const text = fs.readFileSync(specPath, 'utf8');
    const { gate } = parseSpec(text);
    if (!gate) throw new Error(`${specFile} has no "Verification Gate" section.`);
    if (!gate.command) throw new Error(`${specFile}: the verification command is still a placeholder.`);
    if (!gate.expected) throw new Error(`${specFile}: the expected output is still a placeholder.`);

    log(`$ ${gate.command}\n`);
    const result = spawnSync(gate.command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    log(output.trimEnd());

    const missing = matchExpected(gate.expected, output);
    const exitCode = result.status === null ? `signal ${result.signal}` : result.status;
    const pass = result.status === 0 && missing.length === 0;

    log('');
    if (result.status !== 0) log(`❌ Command exited with ${exitCode}.`);
    for (const line of missing) log(`❌ Expected output not found: ${line}`);
    if (pass) log('✅ Verification gate passed.');

    if (record) {
        const today = date || new Date().toISOString().slice(0, 10);
        const value = `${today} ${pass ? 'PASS' : 'FAIL'} (commit ${currentCommit(root)}, exit ${exitCode})`;
        fs.writeFileSync(specPath, withLastVerified(text, value));
        log(`📝 Recorded in ${specFile}: Last Verified ${value}`);
    }
    return { pass, exitCode, missing };
}

if (require.main === module) {
    try {
        const { pass } = verify({ record: process.argv.includes('--record') });
        process.exit(pass ? 0 : 1);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(2);
    }
}

module.exports = { matchExpected, verify };
