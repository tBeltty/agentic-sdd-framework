#!/usr/bin/env node

/**
 * scripts/sdd-report.js
 *
 * Builds a single, self-contained HTML report (.sdd/report.html) combining what
 * docs/SPEC.md already records (tasks, evidence, Last Verified) with the session log
 * (.sdd/session-log.jsonl, see docs/guides/AGENT_HOOKS.md) and recent git history.
 * Purely informational: it never blocks anything, and is not part of quality-gate.js.
 *
 * Degrades gracefully: a project that never ran `sdd-init --guardrails`, or whose agent
 * has no hook adapter, has no session log -- the report still renders from the spec and
 * git history alone.
 *
 * Usage: node sdd-report.js [--out=<path>]
 */

const fs = require('fs');
const path = require('path');
const { repoRoot, git, WORKTREE } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { parseSpec } = require('./lib/spec');
const { readEvents } = require('./lib/session-log');

const RECENT_COMMITS = 20;

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadSpec(root) {
    const specFile = getIn(loadConfig(root, WORKTREE), 'specification.specFile', 'docs/SPEC.md');
    const specPath = path.join(root, specFile);
    if (!fs.existsSync(specPath)) return { specFile, spec: null };
    return { specFile, spec: parseSpec(fs.readFileSync(specPath, 'utf8')) };
}

function recentCommits(root) {
    try {
        return git(['log', `-${RECENT_COMMITS}`, '--pretty=%h|%ad|%s', '--date=short'], root)
            .split('\n').filter(Boolean)
            .map(line => { const [hash, date, ...rest] = line.split('|'); return { hash, date, subject: rest.join('|') }; });
    } catch {
        return [];
    }
}

function groupEventsByTask(events) {
    const groups = new Map();
    for (const event of events) {
        const key = event.taskId || '(no task)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(event);
    }
    return groups;
}

// Status colors are reserved (good/warning/critical) and always paired with an icon and a
// short label, never color alone or a full sentence -- see the dataviz skill's
// palette.md. Longer detail (a denial reason) goes in the native title tooltip, not
// stretched into the pill itself.
function badge(tone, label, title) {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<span class="badge badge--${tone}"${titleAttr}>${escapeHtml(label)}</span>`;
}

function renderTask(task) {
    const state = task.checked ? badge('good', '✓ done') : badge('muted', '○ pending');
    const evidence = task.evidence.recorded
        ? (task.evidence.recorded.intact
            ? `sdd-verify ${task.evidence.recorded.date}, exit ${task.evidence.recorded.exit}`
            : `${badge('critical', '⚠ tampered')} sdd-verify ${task.evidence.recorded.date}, exit ${task.evidence.recorded.exit} -- hash mismatch`)
        : (task.evidence.text ? `${badge('warning', '◐ manual')} not recorded by sdd-verify` : '<span class="muted">none</span>');
    return `<tr><td>${state}</td><td><code>${escapeHtml(task.id)}</code></td><td>${evidence}</td></tr>`;
}

// A short, fixed set of labels keeps every status pill the same shape; anything that
// varies per event (the denial reason, the exit code) goes in the title tooltip instead
// of stretching the pill -- see the dataviz skill's "selective direct labels" rule.
function renderEvent(event) {
    const detail = event.command || event.filePath || '';
    const time = event.ts ? event.ts.replace(/^.*T(\d\d:\d\d:\d\d).*$/, '$1') : '';
    const status = event.denied
        ? badge('critical', 'denied', event.reason)
        : event.event === 'pre'
            ? badge('muted', 'started')
            : (typeof event.exitCode === 'number' && event.exitCode !== 0
                ? badge('critical', 'failed', `exit ${event.exitCode}`)
                : badge('good', 'done', typeof event.exitCode === 'number' ? `exit ${event.exitCode}` : undefined));
    return `<tr><td><span title="${escapeHtml(event.ts)}">${escapeHtml(time)}</span></td><td>${escapeHtml(event.agent)}</td><td>${escapeHtml(event.tool)}</td><td><code>${escapeHtml(detail)}</code></td><td>${status}</td></tr>`;
}

function renderCommit(commit) {
    return `<tr><td><code>${escapeHtml(commit.hash)}</code></td><td>${escapeHtml(commit.date)}</td><td>${escapeHtml(commit.subject)}</td></tr>`;
}

// Colors: the dataviz skill's validated reference palette (chart chrome/ink + the fixed
// status palette, references/palette.md), not a generated gradient. Dark mode follows
// `color-scheme` / prefers-color-scheme per the modern-web-guidance dark-mode guide --
// selected explicitly for the dark surface, not an automatic filter.
const STYLE = `
:root {
  color-scheme: light dark;
  --page:      #f9f9f7;
  --surface:   #fcfcfb;
  --ink:       #0b0b0b;
  --ink-2:     #52514e;
  --ink-muted: #898781;
  --hairline:  #e1e0d9;
  --border:    rgba(11, 11, 11, 0.10);
  --good:      #0ca30c;
  --warning:   #fab219;
  --serious:   #ec835a;
  --critical:  #d03b3b;
  --good-bg:      color-mix(in srgb, var(--good) 14%, var(--surface));
  --warning-bg:   color-mix(in srgb, var(--warning) 18%, var(--surface));
  --critical-bg:  color-mix(in srgb, var(--critical) 14%, var(--surface));
  --muted-bg:     color-mix(in srgb, var(--ink-muted) 14%, var(--surface));
}
@media (prefers-color-scheme: dark) {
  :root {
    --page:      #0d0d0d;
    --surface:   #1a1a19;
    --ink:       #ffffff;
    --ink-2:     #c3c2b7;
    --ink-muted: #898781;
    --hairline:  #2c2c2a;
    --border:    rgba(255, 255, 255, 0.10);
    --good:      #0ca30c;
    --warning:   #fab219;
    --serious:   #ec835a;
    --critical:  #e66767;
  }
}
* { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--page);
  color: var(--ink);
  max-width: 960px;
  margin: 0 auto;
  padding: 2.5rem 1.25rem 4rem;
  line-height: 1.5;
}
h1 { font-size: 1.5rem; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 0.2rem; }
h2 { font-size: 1.05rem; font-weight: 650; margin: 0 0 0.75rem; }
h3 { font-size: 0.85rem; font-weight: 650; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.04em; margin: 1.25rem 0 0.4rem; }
.meta { color: var(--ink-muted); font-size: 0.85rem; margin: 0 0 2.5rem; }
section.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.5rem 1.5rem;
  margin-bottom: 1.5rem;
}
table { border-collapse: collapse; width: 100%; margin-top: 0.25rem; }
table.log, table.tasks { table-layout: fixed; }
table.log td, table.tasks td { overflow-wrap: anywhere; }
table.log td:not(:nth-child(4)) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
table.tasks td:nth-child(1) { white-space: nowrap; }
th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--hairline); font-size: 0.85rem; vertical-align: top; }
th { color: var(--ink-muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
tr:last-child td { border-bottom: none; }
code { background: var(--muted-bg); color: var(--ink-2); padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.82em; }
.muted { color: var(--ink-muted); }
.badge {
  display: inline-flex; align-items: center; gap: 0.3em;
  padding: 0.12rem 0.55rem; border-radius: 999px; max-width: 100%;
  font-size: 0.72rem; font-weight: 600; white-space: normal; overflow-wrap: anywhere;
}
.badge--good { background: var(--good-bg); color: var(--good); }
.badge--warning { background: var(--warning-bg); color: color-mix(in srgb, var(--warning) 55%, var(--ink)); }
.badge--critical { background: var(--critical-bg); color: var(--critical); }
.badge--muted { background: var(--muted-bg); color: var(--ink-muted); }
`;

function buildHtml({ specFile, spec, events, commits }) {
    const taskRows = spec ? spec.tasks.map(renderTask).join('\n') : '';
    const groups = groupEventsByTask(events);
    const sessionSections = [...groups.entries()].map(([taskId, taskEvents]) => `
    <h3>${escapeHtml(taskId)}</h3>
    <table class="log">
    <colgroup><col style="width:9ch"><col style="width:12ch"><col style="width:7ch"><col><col style="width:11ch"></colgroup>
    <thead><tr><th>Time</th><th>Agent</th><th>Tool</th><th>Detail</th><th>Status</th></tr></thead>
    <tbody>${taskEvents.map(renderEvent).join('\n')}</tbody></table>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>Agentic SDD Report</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Agentic SDD Report</h1>
<p class="meta">Generated ${new Date().toISOString()}</p>

<section class="card">
<h2>Specification (${escapeHtml(specFile)})</h2>
${spec
    ? `<p>Status: <strong>${escapeHtml(spec.status || 'unknown')}</strong>${spec.gate && spec.gate.lastVerified ? ` &mdash; Last Verified: ${escapeHtml(spec.gate.lastVerified)}` : ''}</p>
<table class="tasks"><colgroup><col style="width:11ch"><col style="width:7ch"><col></colgroup><thead><tr><th></th><th>Task</th><th>Evidence</th></tr></thead><tbody>${taskRows || '<tr><td colspan="3" class="muted">No tasks.</td></tr>'}</tbody></table>`
    : `<p class="muted">No spec found at ${escapeHtml(specFile)}.</p>`}
</section>

<section class="card">
<h2>Session log</h2>
${events.length > 0 ? sessionSections : '<p class="muted">No session log entries (.sdd/session-log.jsonl not found, or empty -- run <code>sdd-init --guardrails</code> and work a session with a supported agent).</p>'}
</section>

<section class="card">
<h2>Recent commits</h2>
${commits.length > 0
    ? `<table><thead><tr><th>Commit</th><th>Date</th><th>Subject</th></tr></thead><tbody>${commits.map(renderCommit).join('\n')}</tbody></table>`
    : '<p class="muted">No commit history available.</p>'}
</section>
</body>
</html>
`;
}

function buildReport({ root = repoRoot(), out } = {}) {
    const { specFile, spec } = loadSpec(root);
    const events = readEvents(root);
    const commits = recentCommits(root);
    const html = buildHtml({ specFile, spec, events, commits });
    const outPath = out ? path.resolve(root, out) : path.join(root, '.sdd/report.html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    return outPath;
}

function parseArgs(argv) {
    const outFlag = argv.find(a => a.startsWith('--out='));
    return { out: outFlag ? outFlag.slice('--out='.length) : undefined };
}

function main() {
    const { out } = parseArgs(process.argv.slice(2));
    try {
        const outPath = buildReport({ out });
        console.log(`✅ Report written to ${outPath}`);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) main();

module.exports = { buildReport, buildHtml, groupEventsByTask };
