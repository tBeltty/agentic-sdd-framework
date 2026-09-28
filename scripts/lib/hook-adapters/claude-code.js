/**
 * scripts/lib/hook-adapters/claude-code.js
 *
 * Normalizes a Claude Code PreToolUse/PostToolUse hook payload (see
 * https://docs.claude.com/en/docs/claude-code/hooks) into this framework's own
 * agent-agnostic session-log event shape. See docs/guides/AGENT_HOOKS.md for that
 * schema and for how to write an adapter for a different agent's own hook format.
 *
 * Claude Code's hook payload can gain fields across versions; this only reads the ones
 * the session log actually needs, and ignores everything else.
 */

const EVENT_NAMES = { PreToolUse: 'pre', PostToolUse: 'post' };

function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('claude-code adapter: empty or non-object hook payload.');
    const event = EVENT_NAMES[raw.hook_event_name];
    if (!event) throw new Error(`claude-code adapter: unsupported hook_event_name "${raw.hook_event_name}".`);

    const input = raw.tool_input || {};
    const out = { ts: new Date().toISOString(), agent: 'claude-code', event, tool: raw.tool_name || 'unknown' };

    if (raw.tool_name === 'Bash' && typeof input.command === 'string') out.command = input.command;
    if ((raw.tool_name === 'Edit' || raw.tool_name === 'Write') && typeof input.file_path === 'string') out.filePath = input.file_path;
    if (event === 'post' && raw.tool_response && typeof raw.tool_response.exitCode === 'number') out.exitCode = raw.tool_response.exitCode;

    return out;
}

module.exports = { normalize };
