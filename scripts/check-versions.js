#!/usr/bin/env node

/**
 * scripts/check-versions.js
 *
 * Version Sync Checker for the framework repository itself.
 * When sdd.config.json declares project.type "framework", package.json and
 * sdd.config.json must carry the same version. In projects bootstrapped by sdd-init,
 * sdd.config.json "version" records the framework version that generated it and is
 * unrelated to the project's own version, so the check does not apply.
 */

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');

function run({ root = repoRoot() } = {}) {
    if (!fs.existsSync(path.join(root, 'sdd.config.json'))) {
        return { ok: false, report: '❌ sdd.config.json not found. Run sdd-init first.' };
    }
    const config = loadConfig(root);
    const type = getIn(config, 'project.type', 'application');
    if (type !== 'framework') {
        return { ok: true, report: `⏭️  Not applicable (project.type is "${type}"; only the framework repository syncs versions).` };
    }

    const packageJsonPath = path.join(root, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return { ok: false, report: '❌ package.json not found.' };
    }
    const pkgVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
    const configVersion = config.version;
    const summary = `  - package.json:    ${pkgVersion}\n  - sdd.config.json: ${configVersion}\n\n`;

    if (pkgVersion !== configVersion) {
        return {
            ok: false,
            report: summary + `❌ Version mismatch: package.json (${pkgVersion}) !== sdd.config.json (${configVersion}).\n` +
                'Action: Synchronize version strings before committing.'
        };
    }
    return { ok: true, report: summary + '✅ Version manifests are in sync.' };
}

if (require.main === module) {
    console.log('\n======================================================');
    console.log('  🏷️  Agentic SDD Framework: Version Sync Check');
    console.log('======================================================\n');
    const result = run();
    (result.ok ? console.log : console.error)(result.report + '\n');
    process.exit(result.ok ? 0 : 1);
}

module.exports = { run };
