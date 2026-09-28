/**
 * scripts/lib/guardrails-provision.js
 *
 * The --guardrails scaffolding step of provision.js, split into its own module to keep
 * provision.js under the file-size limit: writes/merges .claude/settings.json's hooks and
 * ensures .gitignore covers the local, per-session files the session log writes. See
 * docs/guides/AGENT_HOOKS.md.
 */

const fs = require('fs');
const path = require('path');

// Appends our PreToolUse/PostToolUse hook entry to .claude/settings.json's "hooks" object
// instead of overwriting it, so any hooks a project already configured survive. Dedupes on
// the exact command string, so rerunning sdd-init --guardrails doesn't add it twice.
function mergeHookEntry(existingList, matcher, command) {
    const list = Array.isArray(existingList) ? existingList.map(entry => ({ ...entry })) : [];
    const already = list.some(entry => Array.isArray(entry.hooks) && entry.hooks.some(h => h && h.command === command));
    return already ? list : [...list, { matcher, hooks: [{ type: 'command', command }] }];
}

function writeClaudeSettings(at, record, command) {
    const rel = '.claude/settings.json';
    const file = at(rel);
    const existed = fs.existsSync(file);
    let settings = {};
    if (existed) {
        try {
            settings = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            return record('skipped', `${rel}: not valid JSON (${error.message}); add the hooks manually, see docs/guides/AGENT_HOOKS.md`);
        }
    }
    const hooks = { ...(settings.hooks || {}) };
    const beforePre = JSON.stringify(hooks.PreToolUse || []);
    const beforePost = JSON.stringify(hooks.PostToolUse || []);
    hooks.PreToolUse = mergeHookEntry(hooks.PreToolUse, 'Bash', command);
    hooks.PostToolUse = mergeHookEntry(hooks.PostToolUse, 'Bash', command);
    if (existed && JSON.stringify(hooks.PreToolUse) === beforePre && JSON.stringify(hooks.PostToolUse) === beforePost) {
        return record('kept', rel);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...settings, hooks }, null, 2) + '\n');
    record(existed ? 'updated' : 'created', rel);
}

// Creates .gitignore if absent, otherwise appends only the entries it doesn't already have.
function ensureGitignoreEntries(at, record, entries) {
    const rel = '.gitignore';
    const file = at(rel);
    const existed = fs.existsSync(file);
    const existing = existed ? fs.readFileSync(file, 'utf8') : '';
    const lines = existing.split('\n').map(l => l.trim());
    const missing = entries.filter(entry => !lines.includes(entry));
    if (missing.length === 0) return record('kept', rel);
    const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
    fs.writeFileSync(file, prefix + missing.join('\n') + '\n');
    record(existed ? 'updated' : 'created', rel);
}

module.exports = { mergeHookEntry, writeClaudeSettings, ensureGitignoreEntries };
