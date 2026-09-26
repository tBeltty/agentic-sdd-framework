/**
 * scripts/lib/spec-markup.js
 *
 * Markdown structure for the Lite specification parser (spec.js): which lines are HTML
 * comments or fenced code, and which markup falls outside the subset the parser follows.
 */

const { createFenceTracker } = require('./markdown');

const TASK_RE = /^(\s*)(?:[*+-]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$/;
const indentOf = line => line.match(/^\s*/)[0].length;
const stripQuote = line => line.replace(/^(\s*>\s?)+/, '');

// Spec structure that must never sit inside an HTML comment.
const STRUCTURE_RE = /\[( |x|X)\]|\*\*(?:Status|Verification Command|Expected Output|Last Verified|Evidence):\*\*|`{3,}|~{3,}/i;

// Marks the lines of HTML comment blocks: a line whose content starts with `<!--` (outside
// fenced code) opens one, and the first line containing `-->` after it closes it.
function commentLines(lines) {
    const fence = createFenceTracker();
    let inComment = false;
    return lines.map(line => {
        if (inComment) {
            if (line.includes('-->')) inComment = false;
            return true;
        }
        if (fence.update(line) || fence.inside) return false;
        const content = stripQuote(line).trimStart();
        if (!content.startsWith('<!--')) return false;
        inComment = !content.slice(4).includes('-->');
        return true;
    });
}

// Blanks HTML comment blocks (keeping line numbers).
const uncommented = (lines, hidden) => lines.map((line, i) => (hidden[i] ? '' : line));

// Lines that render as content: also blanks fenced code.
function visibleLines(lines, hidden = commentLines(lines)) {
    const fence = createFenceTracker();
    return uncommented(lines, hidden).map(line => (fence.update(line) || fence.inside ? '' : line));
}

/*
 * The specification is written in a strict subset of Markdown, in which the line-based
 * parse above matches how CommonMark and GitHub render the document. Markup outside the
 * subset is reported as a problem instead of being guessed at, because every place the
 * parser and the renderer disagree is a place to hide an unchecked task or a second Status:
 *   - indentation uses spaces, never tabs;
 *   - fences sit on their own line (never after a list or blockquote marker, as in
 *     `* ~~~`), open and close at most 3 spaces past their list item (or the margin), are
 *     always closed, hold no line indented less than the opening fence (so no list item
 *     can end inside them), and are not inside blockquotes;
 *   - backticks pair up on each line (code spans do not span lines);
 *   - no raw HTML outside code, except whole-line comment blocks that start at column 0
 *     (never inside a list item or blockquote), hold no spec structure, and end with `-->`;
 *   - link reference definitions fit on one line;
 *   - Status, Verification Command, Expected Output and Last Verified appear in their exact
 *     form; lines that only resemble them are errors.
 */
const LIST_ITEM_RE = /^(\s*)([*+-]|\d{1,9}[.)])( {1,4}|$)/;
const ESCAPABLE_RE = /[!-/:-@[-`{-~]/;
const AUTOLINK_RE = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[^\s<>@]+@[^\s<>]+>/g;
const RAW_HTML_RE = /<(?:[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|\/[A-Za-z]|!|\?)/;
const LINK_DEFINITION_RE = /^ {0,3}\[[^\]]+\]:/;
const COMPLETE_DEFINITION_RE = /^ {0,3}\[[^\]]+\]:\s*\S+(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
const FIELD_LIKE = [
    { name: 'Status', loose: /^[^A-Za-z0-9]*status[^A-Za-z0-9]*:/i, exact: /^\*\*Status:\*\*\s/ },
    { name: 'Verification Command', loose: /^[^A-Za-z0-9]*verification\s+command[^A-Za-z0-9]*:/i, exact: /^\* \*\*Verification Command:\*\*/ },
    { name: 'Expected Output', loose: /^[^A-Za-z0-9]*expected\s+output[^A-Za-z0-9]*:/i, exact: /^\* \*\*Expected Output:\*\*/ },
    { name: 'Last Verified', loose: /^[^A-Za-z0-9]*last\s+verified[^A-Za-z0-9]*:/i, exact: /^\* \*\*Last Verified:\*\*/ }
];
const TASK_LIKE_RE = /^[^A-Za-z0-9[]*\[[ xX]\]/;
// A fence after one or more list or blockquote markers on the same line ("* ~~~", "1. > ```").
const MARKER_FENCE_RE = /^\s*(?:(?:[*+-]|\d{1,9}[.)]|>)[ \t]*)+(?:`{3,}|~{3,})/;

// Content column of the list item that contains lines[at] (0 at the top level).
function containerIndent(lines, at) {
    let minIndent = Infinity;
    for (let i = at - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.trim() === '') continue;
        const item = line.match(LIST_ITEM_RE);
        if (item) {
            const content = item[1].length + item[2].length + (item[3] ? item[3].length : 1);
            if (minIndent >= content && indentOf(lines[at]) >= content) return content;
        }
        minIndent = Math.min(minIndent, indentOf(line));
        if (minIndent === 0 && !item) return 0;
    }
    return 0;
}

// The line with code spans and backslash escapes removed, or null when a backtick run has
// no matching run on the same line.
function proseOf(line) {
    let out = '';
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && ESCAPABLE_RE.test(line[i + 1] || '')) {
            out += ' ';
            i += 2;
        } else if (ch === '`') {
            let n = 0;
            while (line[i + n] === '`') n++;
            let j = i + n;
            let close = -1;
            while (j < line.length) {
                if (line[j] !== '`') { j++; continue; }
                let m = 0;
                while (line[j + m] === '`') m++;
                if (m === n) { close = j; break; }
                j += m;
            }
            if (close === -1) return null;
            out += ' ';
            i = close + n;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

// Problems for markup outside the supported subset (see above).
function ambiguousMarkup(lines, hidden) {
    const problems = [];
    const at = (i, what) => problems.push(`Line ${i + 1}: ${what}`);
    const unquoted = lines.map(stripQuote);
    const fence = createFenceTracker();
    let fenceContainer = 0;
    let fenceIndent = 0;
    const counts = Object.fromEntries(FIELD_LIKE.map(f => [f.name, 0]));
    unquoted.forEach((line, i) => {
        const quoted = line !== lines[i];
        const leading = line.match(/^\s*/)[0];
        if (hidden[i]) {
            if (STRUCTURE_RE.test(line)) at(i, 'an HTML comment holds spec structure (a task, Status, gate field, or code fence). Move it out of the comment or delete it.');
            const opening = i === 0 || !hidden[i - 1];
            if (opening && (quoted || indentOf(line) > 0)) {
                at(i, 'HTML comments are supported only at the top level, starting at column 0. Move or remove this one.');
            }
            const closing = i === lines.length - 1 || !hidden[i + 1];
            if (closing && !line.trimEnd().endsWith('-->')) at(i, 'an HTML comment block must end with "-->" at the end of its last line (and must be closed).');
            return;
        }
        const wasInside = fence.inside;
        if (wasInside && line.trim() !== '' && indentOf(line) < fenceIndent) {
            at(i, `this line is inside a fence but indented less than its opening fence (${fenceIndent} spaces); Markdown may end the fence here. Indent it at least as far as the fence, or close the fence first.`);
        }
        if (fence.update(line)) {
            if (/\t/.test(leading)) at(i, 'fences must be indented with spaces, not tabs.');
            if (quoted) at(i, 'fences inside blockquotes are not supported. Move the fence out of the blockquote.');
            const container = wasInside ? fenceContainer : containerIndent(unquoted, i);
            if (indentOf(line) > container + 3) {
                at(i, wasInside
                    ? `this closing fence is indented ${indentOf(line)} spaces, so Markdown treats it as code and the block stays open. Indent it at most 3 spaces past its list item.`
                    : `this fence is indented ${indentOf(line)} spaces, so Markdown renders it as indented code and everything after it stays visible. Indent it at most 3 spaces past its list item.`);
            }
            if (!wasInside) {
                fenceContainer = container;
                fenceIndent = indentOf(line);
            }
            return;
        }
        if (fence.inside) return;
        if (MARKER_FENCE_RE.test(lines[i])) {
            at(i, 'a fence on the same line as a list or blockquote marker is not supported. Put the fence on its own line, indented under the item.');
        }
        if (/\t/.test(leading)) at(i, 'indent with spaces, not tabs (Markdown expands a tab to 4 columns).');
        const prose = proseOf(line);
        if (prose === null) {
            at(i, 'a backtick code span is not closed on the same line. Close it on this line, or escape the backtick as \\`.');
            return;
        }
        if (RAW_HTML_RE.test(prose.replace(AUTOLINK_RE, ' '))) {
            at(i, 'raw HTML is not supported in the specification (it can hide or change what renders). Use Markdown, or put it in a code span.');
        }
        if (LINK_DEFINITION_RE.test(line) && !COMPLETE_DEFINITION_RE.test(line)) {
            at(i, 'a link reference definition must fit on one line.');
        }
        const trimmed = line.trim();
        for (const field of FIELD_LIKE) {
            if (!field.loose.test(trimmed)) continue;
            counts[field.name]++;
            if (!field.exact.test(line) || quoted) at(i, `write the ${field.name} line exactly as in the template ("${field.name === 'Status' ? '**Status:** <value>' : `* **${field.name}:**`}" at the start of the line, outside blockquotes).`);
        }
        if (TASK_LIKE_RE.test(trimmed) && !TASK_RE.test(line)) {
            at(i, 'this looks like a task but is not a list item ("* [ ] **T1:** ..."), so it is not checked. Fix the list marker or remove the brackets.');
        }
    });
    if (fence.inside) problems.push('A fence is never closed. Close every fence with a matching line of backticks or tildes.');
    for (const field of FIELD_LIKE.slice(1)) {
        if (counts[field.name] > 1) problems.push(`${counts[field.name]} "${field.name}" lines; keep exactly one, in the Verification Gate section.`);
    }
    return problems;
}

module.exports = { TASK_RE, LIST_ITEM_RE, indentOf, stripQuote, commentLines, uncommented, visibleLines, ambiguousMarkup };
