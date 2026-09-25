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

const { readFile, WORKTREE } = require('./lib/git');
const { parseConfig, getIn } = require('./lib/config');
const { runCheckCli } = require('./lib/cli');

function run({ root, source = WORKTREE } = {}) {
    const configBuffer = readFile(root, 'sdd.config.json', source);
    if (!configBuffer) {
        return { ok: false, report: '❌ sdd.config.json not found. Run sdd-init first.' };
    }
    const config = parseConfig(configBuffer.toString('utf8'));
    const type = getIn(config, 'project.type', 'application');
    if (type !== 'framework') {
        return { ok: true, report: `⏭️  Not applicable (project.type is "${type}"; only the framework repository syncs versions).` };
    }

    const packageBuffer = readFile(root, 'package.json', source);
    if (!packageBuffer) {
        return { ok: false, report: '❌ package.json not found.' };
    }
    const pkgVersion = JSON.parse(packageBuffer.toString('utf8')).version;
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
    runCheckCli('🏷️  Agentic SDD Framework: Version Sync Check', run);
}

module.exports = { run };
