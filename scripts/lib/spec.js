/**
 * scripts/lib/spec.js
 *
 * Parser and writers for the Lite Mode specification (docs/SPEC.md, from
 * docs/SPEC_TEMPLATE.md): status, task checklist with evidence, verification gate.
 *
 * The spec is read as it renders (see spec-markup.js): a task is a list item whose first
 * paragraph starts with a checkbox (bullets or numbered, also inside blockquotes); its ID is
 * the bold `**T1:**` prefix when present, otherwise "line N". Its evidence is the
 * `**Evidence:**` item of its sub-list, and the command is the first code block rendered in
 * the `**Verification Command:**` item. Markup outside the supported subset is reported as a
 * problem. Line endings are normalized before parsing and preserved when writing.
 *
 * Records written by sdd-verify carry integrity hashes: task evidence covers its date, exit
 * code and transcript; "Last Verified" covers every field plus the verification command and
 * expected output. Editing a record by hand is detected. The hashes are not keyed, so they
 * cannot stop someone who deliberately recomputes them; the authoritative check is running
 * `sdd-verify` again, for example in CI.
 */

const crypto = require('crypto');
const { normalizeEol, detectEol } = require('./markdown');
const { LIST_ITEM_RE, readDocument, gateSection, firstCode, codeText } = require('./spec-markup');

const STATUSES = ['draft', 'in progress', 'completed'];

// A template placeholder is a value that is nothing but one bracketed phrase, such as
// "[command to run tests or validation scripts]". Real commands like `[ -f x ] && make`
// contain more than a single bracketed span.
const isPlaceholder = text => /^\[[^\]]*\]$/.test(text.trim());

const TEMPLATE_STATUS = 'Draft | In Progress | Completed';
const LAST_VERIFIED_VALUE_RE =
    /^(\d{4}-\d{2}-\d{2}) (PASS|FAIL) \(commit ([^,()]+), exit ([^,()]+), state ([0-9a-f]{16}), check ([0-9a-f]{16})\)$/;
const RECORDED_EVIDENCE_RE = /^sdd-verify (\d{4}-\d{2}-\d{2}), exit (-?\d+|timeout|signal \w+), sha256 ([0-9a-f]{16})$/;
const GATE_FIELDS = ['Verification Command', 'Expected Output', 'Last Verified'];

const shortHash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

// Integrity hash of task evidence: date, exit code and transcript together.
function evidenceHash(date, exit, transcript) {
    return shortHash(`${date}\n${exit}\n${transcript}`);
}

// Integrity hash of a Last Verified record, bound to the command and expected output.
function lastVerifiedCheck({ date, result, commit, exit, state }, command, expected) {
    return shortHash([date, result, commit, exit, state, command, expected].join('\n'));
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

// The Status: exactly one line reads as a Status, written "**Status:** <value>" in a
// top-level paragraph. Its value is taken as rendered.
function readStatus(fieldLines, problems) {
    const found = fieldLines.filter(f => f.field.name === 'Status');
    if (found.length === 0) return { status: null, problem: 'No "**Status:**" line.' };
    if (found.length > 1) {
        return { status: null, problem: `${found.length} lines read as a Status (lines ${found.map(f => f.line + 1).join(', ')}); keep exactly one.` };
    }
    const [line] = found;
    const topLevel = line.node.parent.type === 'paragraph' && line.node.parent.parent.type === 'root';
    if (!topLevel || !/^\*\*Status:\*\* \S/.test(line.source)) {
        problems.push(`Line ${line.line + 1}: write the Status line exactly as in the template ("**Status:** <value>" at the start of a line, outside lists and blockquotes).`);
        return { status: null, problem: null };
    }
    const text = line.rendered.text;
    const raw = text.slice(text.indexOf(':') + 1).trim();
    if (raw === TEMPLATE_STATUS) return { status: null, problem: null }; // untouched template
    const value = raw.toLowerCase();
    if (STATUSES.includes(value)) return { status: value, problem: null };
    return { status: null, problem: `Unknown status "${raw}". Use Draft, In Progress, or Completed.` };
}

// The gate fields: each one at most once, as a top-level list item of the Verification Gate
// section that starts with "**<Field>:**". Returns the list item node of each.
function readGateFields(fieldLines, section, problems) {
    const items = {};
    for (const name of GATE_FIELDS) {
        const found = fieldLines.filter(f => f.field.name === name);
        if (found.length > 1) problems.push(`${found.length} lines read as "${name}" (lines ${found.map(f => f.line + 1).join(', ')}); keep exactly one, in the Verification Gate section.`);
        for (const line of found) {
            const list = line.item && line.item.parent;
            const exact = line.item && section && section.nodes.includes(list) && line.source.startsWith(`**${name}:**`);
            if (!exact) {
                problems.push(`Line ${line.line + 1}: write the ${name} line exactly as in the template ("* **${name}:**" as a top-level list item of the Verification Gate section).`);
            } else if (found.length === 1) {
                items[name] = line;
            }
        }
    }
    return items;
}

function parseSpec(rawText) {
    const lines = normalizeEol(rawText).split('\n');
    const doc = readDocument(lines);
    const problems = [...doc.problems];
    const section = gateSection(doc.tree, lines);
    const fields = readGateFields(doc.fieldLines, section, problems);
    let gate = null;
    if (section) {
        const codeOf = name => {
            const code = fields[name] ? firstCode(fields[name].item) : null;
            return code ? codeText(code) : null;
        };
        const command = codeOf('Verification Command');
        const expected = codeOf('Expected Output');
        const last = fields['Last Verified'];
        const lastValue = last ? last.source.slice('**Last Verified:**'.length).trim() : '';
        gate = {
            command: command && !isPlaceholder(command) ? command.trim() : '',
            expected: expected && !isPlaceholder(expected) ? expected.trim() : '',
            lastVerified: lastValue && !isPlaceholder(lastValue) ? lastValue : '',
            lastVerifiedParsed: parseLastVerified(lastValue),
            lastVerifiedLine: last ? last.line : null
        };
        if (gate.lastVerifiedParsed) {
            gate.lastVerifiedParsed.intact =
                lastVerifiedCheck(gate.lastVerifiedParsed, gate.command, gate.expected) === gate.lastVerifiedParsed.check;
        }
    }
    const tasks = doc.tasks.map(task => {
        const { header, code, range } = task.evidence;
        const text = isPlaceholder(header) ? task.evidence.text.replace(header, '').trim() : task.evidence.text;
        const recordedMatch = header.match(RECORDED_EVIDENCE_RE);
        const recorded = recordedMatch
            ? {
                date: recordedMatch[1],
                exit: recordedMatch[2],
                hash: recordedMatch[3],
                intact: code !== null && evidenceHash(recordedMatch[1], recordedMatch[2], code) === recordedMatch[3]
            }
            : null;
        return { ...task, evidence: { text, recorded, range } };
    });
    const { status, problem } = readStatus(doc.fieldLines, problems);
    return { status, statusProblem: problem, tasks, gate, gateRange: section ? [section.from, section.to] : null, hiddenProblems: problems };
}

function withEol(original, normalizedLines) {
    return normalizedLines.join(detectEol(original));
}

// Adds or replaces the "Last Verified" bullet inside the verification gate section.
function withLastVerified(rawText, value) {
    const lines = normalizeEol(rawText).split('\n');
    const spec = parseSpec(rawText);
    if (!spec.gateRange) throw new Error('No "Verification Gate" section found.');
    if (spec.gate.lastVerifiedLine !== null) {
        const at = spec.gate.lastVerifiedLine;
        lines[at] = lines[at].replace(/\*\*Last Verified:\*\*.*$/, `**Last Verified:** ${value}`);
    } else {
        const [from, to] = spec.gateRange;
        let insertAt = to;
        while (insertAt > from + 1 && lines[insertAt - 1].trim() === '') insertAt--;
        lines.splice(insertAt, 0, `* **Last Verified:** ${value}`);
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
    const task = parseSpec(rawText).tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found in the specification.`);
    if (task.quoted) throw new Error(`Task ${taskId} is inside a blockquote; move it out before recording evidence.`);
    // Evidence goes at the item's content column ("* " is 2, "1. " is 3, "10. " is 4), so
    // it renders inside the list item.
    const item = lines[task.line].match(LIST_ITEM_RE);
    const indent = item[1].length + item[2].length + (item[3] ? item[3].length : 1);
    const block = formatRecordedEvidence({ ...evidence, indent });
    if (task.evidence.range) {
        const [start, end] = task.evidence.range;
        let stop = end;
        while (stop > start + 1 && lines[stop - 1].trim() === '') stop--;
        lines.splice(start, stop - start, ...block);
    } else {
        lines.splice(task.blockEnd, 0, ...block);
    }
    lines[task.line] = lines[task.line].replace(/^( *(?:[*+-]|\d{1,9}[.)]) +)\[ \]/, '$1[x]');
    return withEol(rawText, lines);
}

module.exports = {
    STATUSES, isPlaceholder, shortHash, parseSpec, parseLastVerified, formatLastVerified, lastVerifiedCheck,
    evidenceHash, withLastVerified, withTaskEvidence, formatRecordedEvidence
};
