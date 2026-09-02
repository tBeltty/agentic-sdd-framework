#!/usr/bin/env node

/**
 * scripts/check-system-prerequisites.js
 * 
 * Day-0 System Diagnostics Validator
 * Verifies that the local environment meets the minimum prerequisites for
 * Spec-Driven Development (SDD) with AI agents.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function runCommand(command) {
    try {
        return { success: true, output: execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() };
    } catch (error) {
        return { success: false, error: error.message, stderr: error.stderr ? error.stderr.toString().trim() : '' };
    }
}

const checks = [];

// 1. Check Node.js Version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);
if (majorVersion >= 18) {
    checks.push({ name: 'Node.js Runtime', status: 'PASS', detail: `Version ${nodeVersion} (>= 18.x required)` });
} else {
    checks.push({ name: 'Node.js Runtime', status: 'FAIL', detail: `Version ${nodeVersion} detected. Node 18.x or higher is required.` });
}

// 2. Check Git Installation
const gitCheck = runCommand('git --version');
if (gitCheck.success) {
    checks.push({ name: 'Git Binary', status: 'PASS', detail: gitCheck.output });
} else {
    checks.push({ name: 'Git Binary', status: 'FAIL', detail: 'Git is not installed or not in PATH.' });
}

// 3. Check Git Identity (user.name and user.email)
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const gitNameCheck = runCommand('git config --get user.name');
const gitEmailCheck = runCommand('git config --get user.email');
if (gitNameCheck.success && gitEmailCheck.success && gitNameCheck.output && gitEmailCheck.output) {
    checks.push({ name: 'Git Identity', status: 'PASS', detail: `${gitNameCheck.output} <${gitEmailCheck.output}>` });
} else if (isCI) {
    checks.push({ name: 'Git Identity', status: 'PASS', detail: 'CI Runner environment (committer identity not required for builds)' });
} else {
    checks.push({
        name: 'Git Identity',
        status: 'FAIL',
        detail: 'git config user.name or user.email is missing. Run: git config --global user.name "Your Name" && git config --global user.email "your@email.com"'
    });
}

// 4. Check GitHub CLI (gh)
const ghVersionCheck = runCommand('gh --version');
if (ghVersionCheck.success) {
    const firstLine = ghVersionCheck.output.split('\n')[0];
    const ghAuthCheck = runCommand('gh auth status');
    if (ghAuthCheck.success) {
        checks.push({ name: 'GitHub CLI (gh)', status: 'PASS', detail: `${firstLine} (Authenticated)` });
    } else {
        checks.push({
            name: 'GitHub CLI (gh)',
            status: 'WARN',
            detail: `${firstLine} installed, but not authenticated. Run: gh auth login`
        });
    }
} else {
    checks.push({
        name: 'GitHub CLI (gh)',
        status: 'WARN',
        detail: 'gh CLI is not installed. Recommended for automated repository provisioning. See: https://cli.github.com'
    });
}

// 5. Check SSH Keys for secure Git operations
const sshDir = path.join(os.homedir(), '.ssh');
const commonKeys = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
const foundKeys = commonKeys.filter(k => fs.existsSync(path.join(sshDir, k)));
if (foundKeys.length > 0) {
    checks.push({ name: 'SSH Keys', status: 'PASS', detail: `Detected: ${foundKeys.join(', ')} in ~/.ssh/` });
} else {
    checks.push({
        name: 'SSH Keys',
        status: 'WARN',
        detail: 'No standard SSH private keys found in ~/.ssh/. HTTPS credentials or token auth will be required.'
    });
}

// Print Diagnostics Summary
console.log('\n======================================================');
console.log('  🔍 Agentic SDD Framework: Day-0 Environment Check');
console.log('======================================================\n');

let hasFailure = false;
checks.forEach(check => {
    let icon = '✅';
    if (check.status === 'FAIL') {
        icon = '❌';
        hasFailure = true;
    } else if (check.status === 'WARN') {
        icon = '⚠️ ';
    }
    console.log(`${icon} [${check.status}] ${check.name}`);
    console.log(`   ${check.detail}\n`);
});

if (hasFailure) {
    console.log('❌ Environment diagnostic FAILED. Please resolve the critical issues above.\n');
    process.exit(1);
} else {
    console.log('✅ Environment diagnostic PASSED. System is ready for SDD bootstrapping.\n');
    process.exit(0);
}
