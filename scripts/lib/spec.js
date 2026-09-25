/**
 * scripts/lib/spec.js
 *
 * Parser for the Lite Mode specification (docs/SPEC.md, from docs/SPEC_TEMPLATE.md).
 * Extracts the status, the task checklist with each task's evidence, and the
 * verification gate (command, expected output, last recorded verification).
 */

const STATUSES = ['draft', 'in progress', 'completed'];

// A template placeholder is a value that is nothing but one bracketed phrase, such as
// "[command to run tests or validation scripts]". Real commands like `[ -f x ] && make`
// contain more than a single bracketed span.
const isPlaceholder = text => /^\[[^\]]*\]$/.test(text.trim());

const FENCE_RE = /^\s*(```|~~~)/;
const TASK_RE = /^\s*[*-] \[( |x|X)\] \*\*([A-Za-z0-9_.-]+):\*\*\s*(.*)$/;
const FIELD_RE = /^\s*[*-] \*\*([^*]+):\*\*\s*(.*)$/;
const LAST_VERIFIED_RE = /^\s*[*-] \*\*Last Verified:\*\*\s*(.*)$/;

function parseStatus(text) {
    const match = text.match(/^\*\*Status:\*\*\s*(.+?)\s*$/m);
    if (!match || match[1].includes('|')) return null;
    const value = match[1].toLowerCase();
    return STATUSES.includes(value) ? value : null;
}

// Returns [start, end) line indexes of the "## <n>. Verification Gate" section.
function gateBounds(lines) {
    const start = lines.findIndex(l => /^##\s+(?:\d+\.\s*)?Verification Gate\b/i.test(l));
    if (start === -1) return null;
    const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    return [start, next === -1 ? lines.length : next];
}

// Content of the first fenced block after the line matching `label`, within [from, to).
function fencedAfter(lines, label, from, to) {
    const labelIndex = lines.findIndex((l, i) => i >= from && i < to && label.test(l));
    if (labelIndex === -1) return null;
    const open = lines.findIndex((l, i) => i > labelIndex && i < to && FENCE_RE.test(l));
    if (open === -1) return null;
    const close = lines.findIndex((l, i) => i > open && i < to && FENCE_RE.test(l));
    if (close === -1) return null;
    // Blocks nested in a list item are indented like their fence; strip only that indent.
    const indent = lines[open].match(/^\s*/)[0].length;
    return lines.slice(open + 1, close)
        .map(l => (l.slice(0, indent).trim() === '' ? l.slice(indent) : l))
        .join('\n')
        .trim();
}

function parseTasks(lines) {
    const tasks = [];
    let current = null;
    let evidenceLines = null;
    let inFence = false;

    const finish = () => {
        if (!current) return;
        const evidence = (evidenceLines || []).filter(l => !FENCE_RE.test(l)).join('\n').trim();
        current.evidence = evidence && !isPlaceholder(evidence) ? evidence : '';
        tasks.push(current);
    };

    for (const line of lines) {
        if (/^##\s/.test(line) && !inFence) {
            finish();
            current = null;
            evidenceLines = null;
            continue;
        }
        const task = !inFence && line.match(TASK_RE);
        if (task) {
            finish();
            current = { id: task[2], checked: task[1] !== ' ', title: task[3].trim() };
            evidenceLines = null;
            continue;
        }
        if (!current) continue;
        // Task details are indented under the checkbox; an unindented line ends the task.
        if (!inFence && line.trim() !== '' && !/^\s/.test(line)) {
            finish();
            current = null;
            evidenceLines = null;
            continue;
        }
        if (FENCE_RE.test(line)) inFence = !inFence;
        const field = !inFence && line.match(FIELD_RE);
        if (field) {
            evidenceLines = field[1].trim().toLowerCase() === 'evidence' ? [field[2]] : null;
            continue;
        }
        if (evidenceLines) evidenceLines.push(line.trim());
    }
    finish();
    return tasks;
}

function parseSpec(text) {
    const lines = text.split('\n');
    const bounds = gateBounds(lines);
    let gate = null;
    if (bounds) {
        const [from, to] = bounds;
        const command = fencedAfter(lines, /\*\*Verification Command:\*\*/i, from, to);
        const expected = fencedAfter(lines, /\*\*Expected Output:\*\*/i, from, to);
        const lastIndex = lines.findIndex((l, i) => i >= from && i < to && LAST_VERIFIED_RE.test(l));
        const lastValue = lastIndex === -1 ? '' : lines[lastIndex].match(LAST_VERIFIED_RE)[1].trim();
        gate = {
            command: command && !isPlaceholder(command) ? command : '',
            expected: expected && !isPlaceholder(expected) ? expected : '',
            lastVerified: lastValue && !isPlaceholder(lastValue) ? lastValue : ''
        };
    }
    return { status: parseStatus(text), tasks: parseTasks(lines), gate };
}

// Adds or replaces the "Last Verified" bullet inside the verification gate section.
function withLastVerified(text, value) {
    const lines = text.split('\n');
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
    return lines.join('\n');
}

module.exports = { STATUSES, isPlaceholder, parseSpec, withLastVerified };
