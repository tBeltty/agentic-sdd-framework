#!/usr/bin/env node

/**
 * scripts/sdd-init.js
 * 
 * Interactive Day-0 Bootstrapping Wizard for Agentic SDD Framework.
 * Pure Node.js standard library implementation (Zero external npm dependencies).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// Parse CLI Arguments
const args = process.argv.slice(2);
const isExpress = args.includes('--express') || args.some(a => a.startsWith('--mode='));

function getArgValue(prefix, defaultValue) {
    const found = args.find(a => a.startsWith(`--${prefix}=`));
    if (found) return found.split('=')[1];
    return defaultValue;
}

function runSilent(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
        return null;
    }
}

function printHeader() {
    console.log('\n===============================================================');
    console.log('  🧙‍♂️ Agentic SDD Framework: Day-0 Interactive Wizard');
    console.log('  Spec-Driven Development with Autonomous AI Agents');
    console.log('===============================================================\n');
}

async function runGuidedMode() {
    printHeader();
    console.log('Welcome! This wizard sets up progressive SDD governance for your project.\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query, defaultVal) => new Promise(resolve => {
        const promptText = defaultVal ? `${query} [${defaultVal}]: ` : `${query}: `;
        rl.question(promptText, answer => {
            resolve(answer.trim() || defaultVal);
        });
    });

    // Step 1: System Diagnostics
    console.log('--- Step 1: System Prerequisites Check ---');
    try {
        execSync('node scripts/check-system-prerequisites.js', { stdio: 'inherit' });
    } catch {
        console.log('\n⚠️  Prerequisites warning detected. Continuing with configuration...\n');
    }

    // Step 2: Project Metadata
    console.log('\n--- Step 2: Project Definition ---');
    const projectName = await ask('Project Name', path.basename(process.cwd()));
    const runtime = await ask('Primary Runtime / Stack (e.g. node-22-lts, go-1.23, python-3.12)', 'node-22-lts');

    // Step 3: Interactive Constitution
    console.log('\n--- Step 3: Interactive Agent Constitution ---');
    console.log('Define non-negotiable project laws. Each rule includes a "# Why this rule exists" field');
    console.log('to document lessons learned from operational incidents.\n');
    const useDefaultRules = await ask('Seed with 3 fundamental baseline rules (Discovery First, Verify Before Certify, Zero Secrets)? (Y/n)', 'Y');

    // Step 4: 4-Pillar Discovery Interview
    console.log('\n--- Step 4: 4-Pillar Discovery Interview ---');
    const concurrency = await ask('Expected peak concurrency (e.g. 1-10 internal, 100-1,000, 50k+ public)', '1-10 internal');
    const hardware = await ask('Target deployment environment (e.g. local machine, $5 VPS, serverless, cloud)', '$5 VPS');
    const workload = await ask('Primary compute workload (e.g. I/O-heavy API, static SPA, live transcoding)', 'I/O-heavy API');

    // Step 5: Specification Depth (Lite vs Rigor)
    console.log('\n--- Step 5: Specification Depth ---');
    console.log('  [1] 🟢 Lite Mode (Default): Single file docs/SPEC.md (Specify + Plan + Tasks + Gate).');
    console.log('      Recommended for solo developers and rapid MVP building.');
    console.log('  [2] 🔴 Rigor Mode: Full 4-Document Quartet (Plan of Record + Execution Guide + Log + Annex).');
    console.log('      Recommended for multi-agent teams and mission-critical systems.');
    const specChoice = await ask('Select Mode (1 or 2)', '1');
    const specMode = specChoice === '2' ? 'rigor' : 'lite';

    // Step 6: Codebase Navigation Adapter
    console.log('\n--- Step 6: AST Navigation Adapter ---');
    console.log('  [1] ast-grep (Fast native Treesitter structural search, zero Python)');
    console.log('  [2] graphify (Relational knowledge graph, maximum token reduction)');
    console.log('  [3] ripgrep (Universal fast regex baseline)');
    console.log('  [4] lsp (Language Server Protocol / SCIP compiler type indexing)');
    const astChoice = await ask('Select AST Adapter (1-4)', '1');
    const astAdapters = { '1': 'ast-grep', '2': 'graphify', '3': 'ripgrep', '4': 'lsp' };
    const astAdapter = astAdapters[astChoice] || 'ast-grep';

    rl.close();

    bootstrapProject({
        projectName,
        runtime,
        specMode,
        astAdapter,
        concurrency,
        hardware,
        workload,
        useDefaultRules: useDefaultRules.toLowerCase() !== 'n'
    });
}

function runExpressMode() {
    printHeader();
    console.log('⚡ Running Express Mode (Automated setup from CLI flags)...\n');

    const projectName = getArgValue('name', path.basename(process.cwd()));
    const runtime = getArgValue('runtime', 'node-20-lts');
    const specMode = getArgValue('mode', 'lite').toLowerCase();
    const astAdapter = getArgValue('ast', 'ast-grep').toLowerCase();

    bootstrapProject({
        projectName,
        runtime,
        specMode: ['rigor', 'strict'].includes(specMode) ? 'rigor' : 'lite',
        astAdapter: ['graphify', 'ast-grep', 'ripgrep', 'lsp'].includes(astAdapter) ? astAdapter : 'ast-grep',
        concurrency: '1-10 internal',
        hardware: '$5 VPS',
        workload: 'I/O-heavy API',
        useDefaultRules: true
    });
}

function bootstrapProject(config) {
    console.log('\n===============================================================');
    console.log('  📦 Provisioning SDD Governance Structure...');
    console.log('===============================================================\n');

    // 1. Write sdd.config.json
    const configManifest = {
        version: "1.0.0",
        project: {
            name: config.projectName,
            type: "application",
            runtime: config.runtime
        },
        specification: {
            mode: config.specMode,
            allowedModes: ["lite", "rigor"]
        },
        discovery: {
            concurrency: config.concurrency,
            hardware: config.hardware,
            workload: config.workload
        },
        architecture: {
            style: "clean-architecture",
            maxLocPerFile: 400
        },
        capabilities: {
            astNavigation: {
                adapter: config.astAdapter
            },
            noAiSlop: {
                enabled: true
            },
            i18n: {
                enabled: false
            },
            pwa: {
                enabled: false
            }
        }
    };

    fs.writeFileSync('sdd.config.json', JSON.stringify(configManifest, null, 2) + '\n');
    console.log('  ✅ Created sdd.config.json');

    // 2. Initialize .agents/AGENTS.md from template if not present
    if (!fs.existsSync('.agents/AGENTS.md') && fs.existsSync('.agents/AGENTS.template.md')) {
        fs.copyFileSync('.agents/AGENTS.template.md', '.agents/AGENTS.md');
        console.log('  ✅ Initialized .agents/AGENTS.md (Constitution active)');
    }

    // 3. Initialize Specification Document
    if (config.specMode === 'lite') {
        if (!fs.existsSync('docs/SPEC.md') && fs.existsSync('docs/SPEC_TEMPLATE.md')) {
            fs.copyFileSync('docs/SPEC_TEMPLATE.md', 'docs/SPEC.md');
            console.log('  ✅ Initialized docs/SPEC.md (Lite Mode unified specification)');
        }
    } else {
        console.log('  ✅ Rigor Mode enabled: Roadmap templates active in docs/roadmap/');
    }

    // 4. Install Git Pre-push hook
    try {
        execSync('node scripts/install-git-hooks.js', { stdio: 'pipe' });
        console.log('  ✅ Configured pre-push Quality Gate git hook');
    } catch {
        console.log('  ⚠️  Could not auto-install git hook (run npm run install-hooks manually)');
    }

    console.log('\n🎉 Bootstrapping complete!\n');
    console.log('Next steps for AI coding agents:');
    console.log('  1. In your first prompt to Claude Code or Antigravity, say:');
    console.log('     "Read .agents/AGENTS.md and let\'s review the active specification."');
    if (config.specMode === 'lite') {
        console.log('  2. Define your tasks in docs/SPEC.md and implement with verifiable gates.');
    } else {
        console.log('  2. Formulate your Plan of Record in docs/roadmap/ and coordinate with Auditor-Executor.');
    }
    console.log('  3. Run "npm run quality-gate" before every git push.\n');
}

// Entry Point
if (isExpress) {
    runExpressMode();
} else {
    runGuidedMode();
}
