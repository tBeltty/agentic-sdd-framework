#!/usr/bin/env node

/**
 * scripts/install-git-hooks.js
 *
 * Installs a pre-push hook that runs the quality gate before any push.
 * The hooks directory is resolved with `git rev-parse --git-path hooks`, so linked
 * worktrees and core.hooksPath are supported. An existing unmanaged pre-push hook is
 * preserved as pre-push.local and runs first.
 */

const fs = require('fs');
const path = require('path');
const { git, repoRoot } = require('./lib/git');

const MARKER = 'sdd:managed';

function renderHook(gateScript) {
    return `#!/bin/sh
# ${MARKER} pre-push hook installed by the Agentic SDD Framework.
# A pre-existing hook, if any, was moved to pre-push.local and runs first.
HOOK_DIR=$(dirname "$0")
if [ -x "$HOOK_DIR/pre-push.local" ]; then
    INPUT=$(cat)
    printf '%s\\n' "$INPUT" | "$HOOK_DIR/pre-push.local" "$@" || exit 1
fi

if ! node "${gateScript}"; then
    echo "Quality gate failed. Push aborted." >&2
    exit 1
fi
`;
}

function install({ root = repoRoot(), gateScript = path.join(__dirname, 'quality-gate.js') } = {}) {
    let hooksDir;
    try {
        hooksDir = path.resolve(root, git(['rev-parse', '--git-path', 'hooks'], root).trim());
    } catch {
        throw new Error(`${root} is not a git repository.`);
    }
    fs.mkdirSync(hooksDir, { recursive: true });

    const hookPath = path.join(hooksDir, 'pre-push');
    const localPath = path.join(hooksDir, 'pre-push.local');
    let preserved = false;
    if (fs.existsSync(hookPath) && !fs.readFileSync(hookPath, 'utf8').includes(MARKER)) {
        if (fs.existsSync(localPath)) {
            throw new Error(`Both ${hookPath} and pre-push.local exist. Merge them manually, then rerun.`);
        }
        fs.renameSync(hookPath, localPath);
        preserved = true;
    }

    // Git runs hooks from the worktree root, so a root-relative path works in every worktree.
    const relativeGate = path.relative(root, gateScript).split(path.sep).join('/');
    fs.writeFileSync(hookPath, renderHook(relativeGate), { mode: 0o755 });
    fs.chmodSync(hookPath, 0o755);
    return { hookPath, preserved };
}

if (require.main === module) {
    try {
        const { hookPath, preserved } = install();
        if (preserved) console.log('ℹ️  Existing pre-push hook preserved as pre-push.local (runs first).');
        console.log(`✅ Pre-push quality gate hook installed at ${hookPath}\n`);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }
}

module.exports = { MARKER, install };
