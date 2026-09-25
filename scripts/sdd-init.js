#!/usr/bin/env node

/**
 * scripts/sdd-init.js
 *
 * Day-0 Bootstrapping Wizard for the Agentic SDD Framework.
 * Pure Node.js standard library implementation (zero npm dependencies).
 *
 * Usage:
 *   node scripts/sdd-init.js                      Guided mode (interactive)
 *   node scripts/sdd-init.js --express [flags]    Non-interactive mode
 *   npx github:tBeltty/agentic-sdd-framework      Install into the current directory
 *
 * Flags:
 *   --target=<dir>        Project to provision (default: current directory)
 *   --name=<name>         Project name (default: target directory name)
 *   --runtime=<runtime>   e.g. node-22-lts, go-1.23, python-3.12
 *   --mode=lite|rigor     Specification depth (default: lite)
 *   --ast=<adapter>       ast-grep | graphify | ripgrep | lsp (default: ast-grep)
 *   --concurrency=, --hardware=, --workload=   Discovery answers
 *   --i18n, --pwa         Enable the matching capability flags
 *   --force               Refresh copied skills and templates in install mode
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { FRAMEWORK_ROOT, provision } = require('./lib/provision');

const args = process.argv.slice(2);

function getArgValue(name, defaultValue) {
    const found = args.find(a => a.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : defaultValue;
}

const DEFAULTS = {
    runtime: 'node-22-lts',
    concurrency: '1-10 internal',
    hardware: '$5 VPS',
    workload: 'I/O-heavy API'
};

const target = path.resolve(getArgValue('target', process.cwd()));
const force = args.includes('--force');
const wantsExpress = args.includes('--express') || args.some(a => /^--(mode|ast|name|runtime)=/.test(a));

function printHeader() {
    console.log('\n===============================================================');
    console.log('  🧙 Agentic SDD Framework: Day-0 Wizard');
    console.log('  Spec-Driven Development with Autonomous AI Agents');
    console.log('===============================================================\n');
}

async function runGuidedMode() {
    printHeader();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (query, defaultVal) => new Promise(resolve => {
        rl.question(defaultVal ? `${query} [${defaultVal}]: ` : `${query}: `, answer => {
            resolve(answer.trim() || defaultVal);
        });
    });
    const askYesNo = async (query, defaultYes) =>
        (await ask(`${query} (${defaultYes ? 'Y/n' : 'y/N'})`, defaultYes ? 'y' : 'n')).toLowerCase().startsWith('y');

    const installMode = fs.realpathSync(target) !== fs.realpathSync(FRAMEWORK_ROOT);
    if (installMode && !(await askYesNo(`Install SDD governance into ${target}?`, true))) {
        rl.close();
        console.log('Aborted. Pass --target=<dir> to choose another project.');
        return;
    }

    console.log('--- Step 1: System Prerequisites Check ---');
    try {
        execFileSync(process.execPath, [path.join(__dirname, 'check-system-prerequisites.js')], { stdio: 'inherit', cwd: target });
    } catch {
        console.log('\n⚠️  Prerequisites warning detected. Continuing with configuration...\n');
    }

    console.log('\n--- Step 2: Project Definition ---');
    const projectName = await ask('Project Name', path.basename(target));
    const runtime = await ask('Primary Runtime / Stack (e.g. node-22-lts, go-1.23, python-3.12)', DEFAULTS.runtime);

    console.log('\n--- Step 3: 4-Pillar Discovery Interview (recorded in ADR-0001) ---');
    const concurrency = await ask('1. Expected peak concurrency (e.g. 1-10 internal, 100-1,000, 50k+ public)', DEFAULTS.concurrency);
    const hardware = await ask('2. Target deployment environment (e.g. local machine, $5 VPS, serverless, cloud)', DEFAULTS.hardware);
    const workload = await ask('3. Primary compute workload (e.g. I/O-heavy API, static SPA, live transcoding)', DEFAULTS.workload);
    const i18n = await askYesNo('4a. Multi-language support (i18n) required?', false);
    const pwa = await askYesNo('4b. Offline / Progressive Web App support required?', false);

    console.log('\n--- Step 4: Specification Depth ---');
    console.log('  [1] 🟢 Lite Mode (Default): Single file docs/SPEC.md (Specify + Plan + Tasks + Gate).');
    console.log('      Recommended for solo developers and rapid MVP building.');
    console.log('  [2] 🔴 Rigor Mode: Plan of Record + Execution Guide + Compliance Log (+ Remediation annexes).');
    console.log('      Recommended for multi-agent teams and mission-critical systems.');
    const specMode = (await ask('Select Mode (1 or 2)', '1')) === '2' ? 'rigor' : 'lite';

    console.log('\n--- Step 5: AST Navigation Adapter ---');
    console.log('  [1] ast-grep (Fast native Tree-sitter structural search, zero Python)');
    console.log('  [2] graphify (Relational knowledge graph, maximum token reduction)');
    console.log('  [3] ripgrep (Universal fast regex baseline)');
    console.log('  [4] lsp (Language Server Protocol / SCIP compiler type indexing)');
    const astAdapters = { '1': 'ast-grep', '2': 'graphify', '3': 'ripgrep', '4': 'lsp' };
    const astAdapter = astAdapters[await ask('Select AST Adapter (1-4)', '1')] || 'ast-grep';

    rl.close();
    bootstrap({ projectName, runtime, specMode, astAdapter, concurrency, hardware, workload, i18n, pwa });
}

function runExpressMode() {
    printHeader();
    console.log(`⚡ Express Mode: provisioning ${target}\n`);
    bootstrap({
        projectName: getArgValue('name', path.basename(target)),
        runtime: getArgValue('runtime', DEFAULTS.runtime),
        specMode: getArgValue('mode', 'lite').toLowerCase(),
        astAdapter: getArgValue('ast', 'ast-grep').toLowerCase(),
        concurrency: getArgValue('concurrency', DEFAULTS.concurrency),
        hardware: getArgValue('hardware', DEFAULTS.hardware),
        workload: getArgValue('workload', DEFAULTS.workload),
        i18n: args.includes('--i18n'),
        pwa: args.includes('--pwa')
    });
}

function bootstrap(answers) {
    console.log('\n===============================================================');
    console.log('  📦 Provisioning SDD Governance Structure...');
    console.log('===============================================================\n');

    let result;
    try {
        result = provision(answers, { target, force });
    } catch (error) {
        console.error(`\n❌ ${error.message}\n`);
        process.exit(1);
    }

    console.log('\n🎉 Bootstrapping complete!\n');
    console.log('Next steps:');
    console.log('  1. Commit the generated files. AGENTS.md, CLAUDE.md and .claude/skills/ load the');
    console.log('     rules automatically in Claude Code, Codex, Cursor and other AGENTS.md-aware agents.');
    console.log('  2. Record the incident or rationale behind each rule in .agents/AGENTS.md.');
    if (answers.specMode === 'lite') {
        console.log('  3. Define your tasks in docs/SPEC.md and implement with verifiable gates.');
    } else {
        console.log('  3. Write docs/roadmap/PLAN_OF_RECORD.md and coordinate with the Auditor-Executor protocol.');
    }
    console.log(`  4. Quality gate: ${result.gateCommand}${result.hookInstalled ? ' (runs on every git push)' : ''}\n`);
}

if (wantsExpress) {
    runExpressMode();
} else if (!process.stdin.isTTY) {
    console.log('ℹ️  No interactive terminal detected; using Express Mode defaults.');
    runExpressMode();
} else {
    runGuidedMode();
}
