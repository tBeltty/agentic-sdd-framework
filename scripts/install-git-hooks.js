#!/usr/bin/env node

/**
 * scripts/install-git-hooks.js
 * 
 * Local Pre-Push Quality Gate Hook Installer
 * Automatically configures .git/hooks/pre-push to run the Quality Gate
 * before any branch push can be sent to GitHub.
 */

const fs = require('fs');
const path = require('path');

const gitHooksDir = path.join(__dirname, '..', '.git', 'hooks');
const prePushHookPath = path.join(gitHooksDir, 'pre-push');

if (!fs.existsSync(gitHooksDir)) {
    console.error('❌ .git/hooks directory not found. Is this a git repository?');
    process.exit(1);
}

const hookScript = `#!/usr/bin/env bash
# Pre-push hook: Agentic SDD Quality Gate
echo "========================================================"
echo "  🚀 Running Pre-Push Quality Gate Verification..."
echo "========================================================"

npm run quality-gate
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "❌ Quality Gate failed! Push aborted."
    echo "Fix all errors reported above before pushing to remote."
    exit 1
fi

echo ""
echo "✅ Quality Gate passed! Proceeding with push."
exit 0
`;

fs.writeFileSync(prePushHookPath, hookScript, { mode: 0o755 });
console.log('✅ Pre-push Quality Gate hook successfully installed in .git/hooks/pre-push\n');
process.exit(0);
