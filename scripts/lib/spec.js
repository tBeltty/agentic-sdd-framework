/**
 * scripts/lib/spec.js
 *
 * Parser and writers for the Lite Mode specification (docs/SPEC.md, from
 * docs/SPEC_TEMPLATE.md): status, task checklist with evidence, verification gate.
 *
 * Any checkbox list item is a task (bullets or numbered, also inside blockquotes); its ID
 * is the bold `**T1:**` prefix when present, otherwise "line N". Content inside fenced code
 * blocks and HTML comments is ignored, as it is when the Markdown is rendered. Line endings
 * are normalized before parsing and preserved when writing.
 *
 * Records written by sdd-verify carry integrity hashes: task evidence covers its date, exit
 * code and transcript; "Last Verified" covers every field plus the verification command and
 * expected output. Editing a record by hand is detected. The hashes are not keyed, so they
 * cannot stop someone who deliberately recomputes them; the authoritative check is running
 * `sdd-verify` again, for example in CI.
 */

const crypto = require('crypto');
const { normalizeEol, detectEol, createFenceTracker } = require('./markdown');

const STATUSES = ['draft', 'in progress', 'completed'];

// A template placeholder is a value that is nothing but one bracketed phrase, such as
// "[command to run tests or validation scripts]". Real commands like `[ -f x ] && make`
// contain more than a single bracketed span.
const isPlaceholder = text => /^\[[^\]]*\]$/.test(text.trim());

const TEMPLATE_STATUS = 'Draft | In Progress | Completed';
const TASK_RE = /^(\s*)(?:[*+-]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$/;
const FIELD_RE = /^(\s*)[*+-]\s+\*\*([^*]+):\*\*\s*(.*)$/;
const LAST_VERIFIED_RE = /^\s*[*+-]\s+\*\*Last Verified:\*\*\s*(.*)$/;
const LAST_VERIFIED_VALUE_RE =
    /^(\d{4}-\d{2}-\d{2}) (PASS|FAIL) \(commit ([^,()]+), exit ([^,()]+), state ([0-9a-f]{16}), check ([0-9a-f]{16})\)$/;
const RECORDED_EVIDENCE_RE = /^sdd-verify (\d{4}-\d{2}-\d{2}), exit (-?\d+|timeout|signal \w+), sha256 ([0-9a-f]{16})$/;

const indentOf = line => line.match(/^\s*/)[0].length;
const shortHash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const stripQuote = line => line.replace(/^(\s*>\s?)+/, '');

// Lines that render as content: blank out fenced code and HTML comments (keeping line numbers).
function visibleLines(lines) {
    const fence = createFenceTracker();
    let inComment = false;
    return lines.map(line => {
        if (!inComment && (fence.update(line) || fence.inside)) return '';
        let out = '';
        let rest = line;
        while (rest.length > 0) {
            if (inComment) {
                const end = rest.indexOf('-->');
                if (end === -1) return out;
                inComment = false;
                rest = rest.slice(end + 3);
            } else {
                const start = rest.indexOf('<!--');
                if (start === -1) return out + rest;
                out += rest.slice(0, start);
                inComment = true;
                rest = rest.slice(start + 4);
            }
        }
        return out;
    });
}

// Integrity hash of task evidence: date, exit code and transcript together.
function evidenceHash(date, exit, transcript) {
    return shortHash(`${date}\n${exit}\n${transcript}`);
}

// Integrity hash of a Last Verified record, bound to the command and expected output.
function lastVerifiedCheck({ date, result, commit, exit, state }, command, expected) {
    return shortHash([date, result, commit, exit, state, command, expected].join('\n'));
}

// Content of the first fenced block within lines[from, to), dedented to its fence.
function firstFence(lines, from, to) {
    const fence = createFenceTracker();
    let open = -1;
    for (let i = from; i < to; i++) {
        if (!fence.update(lines[i])) continue;
        if (open === -1) {
            open = i;
        } else {
            const indent = indentOf(lines[open]);
            return lines.slice(open + 1, i)
                .map(l => (l.slice(0, indent).trim() === '' ? l.slice(indent) : l))
                .join('\n');
        }
    }
    return null;
}

function parseStatus(visible) {
    const found = visible.map(l => l.match(/^\*\*Status:\*\*\s*(.+?)\s*$/)).filter(Boolean);
    if (found.length === 0) return { status: null, problem: 'No "**Status:**" line.' };
    if (found.length > 1) return { status: null, problem: `${found.length} "**Status:**" lines; keep exactly one.` };
    const raw = found[0][1];
    if (raw === TEMPLATE_STATUS) return { status: null, problem: null }; // untouched template
    const value = raw.toLowerCase();
    if (STATUSES.includes(value)) return { status: value, problem: null };
    return { status: null, problem: `Unknown status "${raw}". Use Draft, In Progress, or Completed.` };
}

function gateBounds(lines) {
    const start = lines.findIndex(l => /^##\s+(?:\d+\.\s*)?Verification Gate\b/i.test(l));
    if (start === -1) return null;
    const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    return [start, next === -1 ? lines.length : next];
}

function parseEvidence(lines, fieldIndex, end) {
    const header = stripQuote(lines[fieldIndex]).match(FIELD_RE)[3].trim();
    const content = firstFence(lines, fieldIndex + 1, end);
    const body = lines.slice(fieldIndex + 1, end).map(l => l.trim()).filter(l => l && !/^(`{3,}|~{3,})/.test(l)).join('\n');
    const text = [isPlaceholder(header) ? '' : header, body].filter(Boolean).join('\n').trim();
    const recordedMatch = header.match(RECORDED_EVIDENCE_RE);
    const recorded = recordedMatch
        ? {
            date: recordedMatch[1],
            exit: recordedMatch[2],
            hash: recordedMatch[3],
            intact: content !== null && evidenceHash(recordedMatch[1], recordedMatch[2], content) === recordedMatch[3]
        }
        : null;
    return { text, recorded, range: [fieldIndex, end] };
}

function parseTasks(rawLines) {
    const tasks = [];
    // Task detection runs on rendered content, with blockquote markers removed.
    const lines = visibleLines(rawLines).map(stripQuote);
    const unquoted = rawLines.map(stripQuote);
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(TASK_RE);
        if (!match) continue;
        const indent = match[1].length;
        const bold = match[3].match(/^\*\*([A-Za-z0-9_.-]+):\*\*\s*(.*)$/);
        const task = {
            id: bold ? bold[1] : `line ${i + 1}`,
            line: i,
            checked: match[2] !== ' ',
            title: (bold ? bold[2] : match[3]).trim(),
            evidence: { text: '', recorded: null, range: null },
            quoted: /^\s*>/.test(rawLines[i])
        };
        // The task block: following lines indented deeper than the checkbox (or blank).
        let end = i + 1;
        const inner = createFenceTracker();
        while (end < unquoted.length) {
            const line = unquoted[end];
            const delimiter = inner.update(line);
            if (!delimiter && !inner.inside && line.trim() !== '' && indentOf(line) <= indent) break;
            end++;
        }
        while (end > i + 1 && unquoted[end - 1].trim() === '') end--;
        // Fields inside the block; the Evidence field runs until the next field or the end.
        const fields = [];
        for (let j = i + 1; j < end; j++) {
            const field = lines[j].match(FIELD_RE);
            if (field && indentOf(lines[j]) > indent) fields.push({ name: field[2].trim().toLowerCase(), index: j });
        }
        const evidenceAt = fields.findIndex(f => f.name === 'evidence');
        if (evidenceAt !== -1) {
            const next = fields[evidenceAt + 1];
            // Evidence content (fences included) is read from the unrendered lines.
            task.evidence = parseEvidence(unquoted, fields[evidenceAt].index, next ? next.index : end);
        }
        task.blockEnd = end;
        tasks.push(task);
    }
    return tasks;
}

function parseLastVerified(value) {
    const match = value.match(LAST_VERIFIED_VALUE_RE);
    if (!match) return null;
    return { date: match[1], result: match[2], commit: match[3], exit: match[4], state: match[5], check: match[6] };
}

function formatLastVerified(fields, command, expected) {
    const check = lastVerifiedCheck(fields, command, expected);
    return `${fields.date} ${fields.result} (commit ${fields.commit}, exit ${fields.exit}, state ${fields.state}, check ${check})`;
}

function parseSpec(rawText) {
    const text = normalizeEol(rawText);
    const lines = text.split('\n');
    const visible = visibleLines(lines);
    const bounds = gateBounds(visible);
    let gate = null;
    if (bounds) {
        const [from, to] = bounds;
        const labelAt = label => lines.findIndex((l, i) => i >= from && i < to && label.test(l));
        const commandAt = labelAt(/\*\*Verification Command:\*\*/i);
        const expectedAt = labelAt(/\*\*Expected Output:\*\*/i);
        const command = commandAt === -1 ? null : firstFence(lines, commandAt + 1, to);
        const expected = expectedAt === -1 ? null : firstFence(lines, expectedAt + 1, to);
        const lastIndex = visible.findIndex((l, i) => i >= from && i < to && LAST_VERIFIED_RE.test(l));
        const lastValue = lastIndex === -1 ? '' : lines[lastIndex].match(LAST_VERIFIED_RE)[1].trim();
        gate = {
            command: command && !isPlaceholder(command) ? command.trim() : '',
            expected: expected && !isPlaceholder(expected) ? expected.trim() : '',
            lastVerified: lastValue && !isPlaceholder(lastValue) ? lastValue : '',
            lastVerifiedParsed: parseLastVerified(lastValue)
        };
        if (gate.lastVerifiedParsed) {
            gate.lastVerifiedParsed.intact =
                lastVerifiedCheck(gate.lastVerifiedParsed, gate.command, gate.expected) === gate.lastVerifiedParsed.check;
        }
    }
    const { status, problem } = parseStatus(visible);
    return { status, statusProblem: problem, tasks: parseTasks(lines), gate };
}

function withEol(original, normalizedLines) {
    return normalizedLines.join(detectEol(original));
}

// Adds or replaces the "Last Verified" bullet inside the verification gate section.
function withLastVerified(rawText, value) {
    const lines = normalizeEol(rawText).split('\n');
    const bounds = gateBounds(lines);
    if (!bounds) throw new Error('No "Verification Gate" section found.');
    const [from, to] = bounds;
    const bullet = `* **Last Verified:** ${value}`;
    const existing = lines.findIndex((l, i) => i >= from && i < to && LAST_VERIFIED_RE.test(l));
    if (existing !== -1) {
        lines[existing] = bullet;
    } else {
        let insertAt = to;
        while (insertAt > from + 1 && lines[insertAt - 1].trim() === '') insertAt--;
        lines.splice(insertAt, 0, bullet);
    }
    return withEol(rawText, lines);
}

// Evidence recorded by `sdd-verify --task`: a header with the exit code and a hash of
// the fenced transcript, so later edits to the transcript are detectable.
function formatRecordedEvidence({ date, exit, transcript, indent }) {
    const pad = ' '.repeat(indent);
    const content = transcript.replace(/\s+$/, '');
    // A backtick fence longer than any backtick run in the content cannot close early.
    const longestRun = Math.max(0, ...(content.match(/`+/g) || []).map(run => run.length));
    const fenceMarker = '`'.repeat(Math.max(3, longestRun + 1));
    return [
        `${pad}* **Evidence:** sdd-verify ${date}, exit ${exit}, sha256 ${evidenceHash(date, exit, content)}`,
        `${pad}  ${fenceMarker}text`,
        ...content.split('\n').map(l => (l ? `${pad}  ${l}` : '')),
        `${pad}  ${fenceMarker}`
    ];
}

// Replaces (or adds) the Evidence field of a task and checks its box.
function withTaskEvidence(rawText, taskId, evidence) {
    const lines = normalizeEol(rawText).split('\n');
    const task = parseTasks(lines).find(t => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found in the specification.`);
    if (task.quoted) throw new Error(`Task ${taskId} is inside a blockquote; move it out before recording evidence.`);
    const indent = indentOf(lines[task.line]) + 2;
    const block = formatRecordedEvidence({ ...evidence, indent });
    if (task.evidence.range) {
        const [start, end] = task.evidence.range;
        let stop = end;
        while (stop > start + 1 && lines[stop - 1].trim() === '') stop--;
        lines.splice(start, stop - start, ...block);
    } else {
        lines.splice(task.blockEnd, 0, ...block);
    }
    lines[task.line] = lines[task.line].replace(/\[( )\]/, '[x]');
    return withEol(rawText, lines);
}

module.exports = {
    STATUSES, isPlaceholder, shortHash, parseSpec, parseLastVerified, formatLastVerified, lastVerifiedCheck,
    evidenceHash, withLastVerified, withTaskEvidence, formatRecordedEvidence
};
