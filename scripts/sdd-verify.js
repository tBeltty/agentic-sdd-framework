#!/usr/bin/env node

/**
 * scripts/sdd-verify.js
 *
 * Runs verification commands for the Lite specification and records the results.
 *
 *   node scripts/sdd-verify.js [--record]
 *       Runs the "Verification Gate" command. Passes when it exits 0, every non-empty
 *       expected line appears in its output (a /.../ line is a regular expression), and it
 *       did not modify tracked files. --record writes
 *       "Last Verified: <date> PASS|FAIL (commit <sha>, exit <code>, state <fingerprint>, check <hash>)"
 *       into the spec; the gate compares that fingerprint with the committed content.
 *
 *   node scripts/sdd-verify.js --task <ID> -- <command ...>
 *       Runs <command>, writes its transcript as the task's Evidence with the exit code and
 *       a hash of the transcript, and checks the task's box.
 *
 * Commands come from the specification or the command line and run in a shell
 * (specification.verifyShell, default /bin/sh or cmd.exe) with a time limit
 * (specification.verifyTimeoutSeconds, default 900). The quality gate never runs them.
 */

const fs = require('fs');
const path = require('path');
const { git, repoRoot, WORKTREE } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { parseSpec, formatLastVerified, withLastVerified, withTaskEvidence } = require('./lib/spec');
const { stateOf, currentCommit } = require('./lib/state');
const { DEFAULT_TIMEOUT_SECONDS, runCommand, joinCommand } = require('./lib/runner');

const MAX_EVIDENCE_LINES = 200;
const USAGE = 'Usage: sdd-verify [--record] | sdd-verify --task <ID> -- <command ...>';

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

function loadLiteSpec(root) {
    const config = loadConfig(root, WORKTREE);
    if (getIn(config, 'specification.mode', 'lite') === 'rigor') {
        throw new Error('sdd-verify covers Lite mode. In Rigor mode, gates are run per task (see the execution guide) and checked with auditkit lint.');
    }
    const specFile = getIn(config, 'specification.specFile', 'docs/SPEC.md');
    const specPath = path.join(root, specFile);
    if (!fs.existsSync(specPath)) throw new Error(`${specFile} not found.`);
    const runOptions = {
        cwd: root,
        timeoutSeconds: getIn(config, 'specification.verifyTimeoutSeconds', DEFAULT_TIMEOUT_SECONDS),
        shell: getIn(config, 'specification.verifyShell', undefined)
    };
    return { specFile, specPath, text: fs.readFileSync(specPath, 'utf8'), runOptions };
}

function today(date) {
    return date || new Date().toISOString().slice(0, 10);
}

// Untracked files take part in the verification but not in the recorded state fingerprint,
// so a recorded PASS could depend on files that are never committed.
function untrackedFiles(root) {
    return git(['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean);
}

async function verify({ root = repoRoot(), record = false, log = console.log, date } = {}) {
    const { specFile, specPath, text, runOptions } = loadLiteSpec(root);
    const { gate } = parseSpec(text);
    if (!gate) throw new Error(`${specFile} has no "Verification Gate" section.`);
    if (!gate.command) throw new Error(`${specFile}: the verification command is still a placeholder.`);
    if (!gate.expected) throw new Error(`${specFile}: the expected output is still a placeholder.`);
    const untracked = untrackedFiles(root);
    if (record && untracked.length > 0) {
        throw new Error(`Untracked files would take part in the verification but not in the recorded state: ${untracked.slice(0, 5).join(', ')}${untracked.length > 5 ? ', ...' : ''}. Commit, ignore, or remove them, then record again.`);
    }
    if (untracked.length > 0) log(`⚠️  ${untracked.length} untracked file(s) take part in this run; --record refuses to run until they are committed, ignored, or removed.`);

    const before = stateOf(root, WORKTREE, specFile);
    log(`$ ${gate.command}\n`);
    const { exit, output } = await runCommand(gate.command, runOptions);
    log(output.trimEnd());
    const after = stateOf(root, WORKTREE, specFile);

    const missing = matchExpected(gate.expected, output);
    const modified = before !== after;
    const pass = exit === '0' && missing.length === 0 && !modified;

    log('');
    if (exit !== '0') log(`❌ Command exited with ${exit}.`);
    for (const line of missing) log(`❌ Expected output not found: ${line}`);
    if (modified) log('❌ The command modified tracked files; verify a clean state, then run it again.');
    if (pass) log('✅ Verification gate passed.');

    if (record) {
        const fields = { date: today(date), result: pass ? 'PASS' : 'FAIL', commit: currentCommit(root), exit, state: before };
        const value = formatLastVerified(fields, gate.command, gate.expected);
        fs.writeFileSync(specPath, withLastVerified(text, value));
        log(`📝 Recorded in ${specFile}: Last Verified ${value}`);
    }
    return { pass, exitCode: exit, missing, modified };
}

async function recordTask({ root = repoRoot(), taskId, command, log = console.log, date } = {}) {
    const { specFile, specPath, text, runOptions } = loadLiteSpec(root);
    if (!parseSpec(text).tasks.some(t => t.id === taskId)) {
        throw new Error(`Task ${taskId} not found in ${specFile}.`);
    }
    log(`$ ${command}\n`);
    const { exit, output } = await runCommand(command, runOptions);
    log(output.trimEnd());

    let lines = output.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
    if (lines.length > MAX_EVIDENCE_LINES) {
        const omitted = lines.length - MAX_EVIDENCE_LINES;
        lines = [...lines.slice(0, MAX_EVIDENCE_LINES / 2), `[... ${omitted} lines omitted ...]`, ...lines.slice(-MAX_EVIDENCE_LINES / 2)];
    }
    const transcript = [`$ ${command}`, ...lines].join('\n');
    fs.writeFileSync(specPath, withTaskEvidence(text, taskId, { date: today(date), exit, transcript }));
    log(`\n${exit === '0' ? '✅' : '❌'} ${taskId}: exit ${exit}, evidence recorded in ${specFile}.`);
    return { exitCode: exit };
}

function parseArgs(argv) {
    const separator = argv.indexOf('--');
    const flags = separator === -1 ? argv : argv.slice(0, separator);
    const command = separator === -1 ? [] : argv.slice(separator + 1);
    const options = { record: false, taskId: null, command: null };
    for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        if (flag === '--record') options.record = true;
        else if (flag === '--task') options.taskId = flags[++i];
        else if (flag.startsWith('--task=')) options.taskId = flag.slice('--task='.length);
        else if (flag === '--help' || flag === '-h') throw new Error(USAGE);
        else throw new Error(`Unknown argument "${flag}". ${USAGE}`);
    }
    if (options.taskId !== null) {
        if (!options.taskId) throw new Error(`--task needs a task ID. ${USAGE}`);
        if (command.length === 0) throw new Error(`--task needs a command after "--". ${USAGE}`);
        if (options.record) throw new Error(`--record and --task are separate modes. ${USAGE}`);
        options.command = joinCommand(command);
    } else if (command.length > 0) {
        throw new Error(`A command after "--" is only used with --task. ${USAGE}`);
    }
    return options;
}

async function main(argv) {
    try {
        const options = parseArgs(argv);
        if (options.taskId) {
            const { exitCode } = await recordTask({ taskId: options.taskId, command: options.command });
            return exitCode === '0' ? 0 : 1;
        }
        const { pass } = await verify({ record: options.record });
        return pass ? 0 : 1;
    } catch (error) {
        console.error(`❌ ${error.message}`);
        return 2;
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).then(code => process.exit(code));
}

module.exports = { matchExpected, parseArgs, verify, recordTask };
