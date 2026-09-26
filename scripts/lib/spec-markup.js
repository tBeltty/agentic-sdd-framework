/**
 * scripts/lib/spec-markup.js
 *
 * Markdown structure for the Lite specification parser (spec.js): which lines are HTML
 * comments or fenced code, and which markup falls outside the subset the parser follows.
 */

const { createFenceTracker } = require('./markdown');

const TASK_RE = /^( *)(?:[*+-]|\d+[.)]) +\[( |x|X)\] +(.*)$/;
// Indentation is spaces only, and a blank line holds only spaces or tabs (CommonMark): a
// non-breaking space is content, not indentation.
const indentOf = line => line.match(/^ */)[0].length;
const isBlank = line => /^[ \t]*$/.test(line);
const stripQuote = line => line.replace(/^( *> ?)+/, '');

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

// Lines that are fence delimiters or fence content. Fences are never inside blockquotes
// (that is outside the subset), so this is computed on the raw lines.
function fenceLines(lines, hidden = commentLines(lines)) {
    const fence = createFenceTracker();
    return uncommented(lines, hidden).map(line => fence.update(line) || fence.inside);
}

// Blockquote markers removed, except inside fences, whose content is verbatim.
function unquoted(lines, hidden = commentLines(lines)) {
    const inFence = fenceLines(lines, hidden);
    return uncommented(lines, hidden).map((line, i) => (inFence[i] ? line : stripQuote(line)));
}

// Lines that render as content: also blanks fenced code.
function visibleLines(lines, hidden = commentLines(lines)) {
    const inFence = fenceLines(lines, hidden);
    return uncommented(lines, hidden).map((line, i) => (inFence[i] ? '' : line));
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
 *   - no HTML entities, non-ASCII whitespace, or invisible characters outside code, and no
 *     link title that spans lines (all can hide or disguise text);
 *   - Status, Verification Command, Expected Output and Last Verified appear in their exact
 *     form; lines that only resemble them (compared after folding case, punctuation, and
 *     look-alike letters) are errors.
 */
const LIST_ITEM_RE = /^( *)([*+-]|\d{1,9}[.)])( {1,4}|$)/;
const ESCAPABLE_RE = /[!-/:-@[-`{-~]/;
const AUTOLINK_RE = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[^\s<>@]+@[^\s<>]+>/g;
const RAW_HTML_RE = /<(?:[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|\/[A-Za-z]|!|\?)/;
const LINK_DEFINITION_RE = /^ {0,3}\[[^\]]+\]:/;
const COMPLETE_DEFINITION_RE = /^ {0,3}\[[^\]]+\]:\s*\S+(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
const FIELD_LIKE = [
    { name: 'Status', key: 'status', exact: /^\*\*Status:\*\* / },
    { name: 'Verification Command', key: 'verificationcommand', exact: /^\* \*\*Verification Command:\*\*/ },
    { name: 'Expected Output', key: 'expectedoutput', exact: /^\* \*\*Expected Output:\*\*/ },
    { name: 'Last Verified', key: 'lastverified', exact: /^\* \*\*Last Verified:\*\*/ }
];
const ENTITY_RE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
// Non-ASCII whitespace and invisible or bidirectional formatting characters.
const INVISIBLE_RE = /[\u00A0\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u1680\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFEFF\uFFA0]/;
// Letters that look like Latin ones (Cyrillic, Greek, Armenian), folded before comparing.
const CONFUSABLES = new Map(Object.entries({
    '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0455': 's', '\u0456': 'i', '\u0458': 'j', '\u0501': 'd', '\u04CF': 'l', '\u0442': 't', '\u0432': 'b',
    '\u043A': 'k', '\u043C': 'm', '\u043D': 'h', '\u057D': 'u', '\u03C5': 'u', '\u03C4': 't', '\u03B9': 'i', '\u03BF': 'o', '\u03B1': 'a', '\u03BD': 'v', '\u03BA': 'k', '\u03C1': 'p', '\u03B5': 'e',
    '\u02D0': ':', '\uA789': ':', '\u0589': ':', '\u2236': ':', '\u02F8': ':', '\u05C3': ':', '\u0703': ':', '\u0704': ':'
}));
// A line reduced to lowercase ASCII letters, digits and colons, look-alikes folded.
const skeleton = line => [...line.normalize('NFKC').toLowerCase()].map(c => CONFUSABLES.get(c) || c).join('').replace(/[^a-z0-9:]/g, '');
const TASK_LIKE_RE = /^[^A-Za-z0-9[]*\[[ xX]\]/;
// A fence after one or more list or blockquote markers on the same line ("* ~~~", "1. > ```").
const MARKER_FENCE_RE = /^[ \t]*(?:(?:[*+-]|\d{1,9}[.)]|>)[ \t]*)+(?:`{3,}|~{3,})/;
const FENCE_LINE_RE = /^[ \t]*(?:`{3,}|~{3,})/;

// True when an inline link or image destination opened on this line ("](") is not closed on
// it; its title would then span lines and hide them.
function unclosedLink(prose) {
    let from = prose.indexOf('](');
    while (from !== -1) {
        let depth = 1;
        let quote = null;
        let i = from + 2;
        for (; i < prose.length && depth > 0; i++) {
            const ch = prose[i];
            if (quote) {
                if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '(') {
                depth++;
            } else if (ch === ')') {
                depth--;
            }
        }
        if (depth > 0 || quote) return true;
        from = prose.indexOf('](', i);
    }
    return false;
}

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
    const outside = unquoted(lines, hidden);
    const fence = createFenceTracker();
    let fenceContainer = 0;
    let fenceIndent = 0;
    let afterDefinition = false;
    const counts = Object.fromEntries(FIELD_LIKE.map(f => [f.name, 0]));
    lines.forEach((raw, i) => {
        if (hidden[i]) {
            const line = stripQuote(raw);
            if (STRUCTURE_RE.test(line)) at(i, 'an HTML comment holds spec structure (a task, Status, gate field, or code fence). Move it out of the comment or delete it.');
            const opening = i === 0 || !hidden[i - 1];
            if (opening && (line !== raw || indentOf(raw) > 0)) {
                at(i, 'HTML comments are supported only at the top level, starting at column 0. Move or remove this one.');
            }
            const closing = i === lines.length - 1 || !hidden[i + 1];
            if (closing && !raw.trimEnd().endsWith('-->')) at(i, 'an HTML comment block must end with "-->" at the end of its last line (and must be closed).');
            afterDefinition = false;
            return;
        }
        // Fence content is verbatim: no blockquote stripping, spaces-only indentation.
        const wasInside = fence.inside;
        if (wasInside && !isBlank(raw) && indentOf(raw) < fenceIndent) {
            at(i, `this line is inside a fence but indented less than its opening fence (${fenceIndent} spaces); Markdown may end the fence here. Indent it at least as far as the fence, or close the fence first.`);
        }
        if (fence.update(raw)) {
            const container = wasInside ? fenceContainer : containerIndent(outside, i);
            if (indentOf(raw) > container + 3) {
                at(i, wasInside
                    ? `this closing fence is indented ${indentOf(raw)} spaces, so Markdown treats it as code and the block stays open. Indent it at most 3 spaces past its list item.`
                    : `this fence is indented ${indentOf(raw)} spaces, so Markdown renders it as indented code and everything after it stays visible. Indent it at most 3 spaces past its list item.`);
            }
            if (!wasInside) {
                fenceContainer = container;
                fenceIndent = indentOf(raw);
            }
            afterDefinition = false;
            return;
        }
        if (fence.inside) return;
        const line = stripQuote(raw);
        const quoted = line !== raw;
        const leading = raw.match(/^[ \t>]*/)[0];
        if (MARKER_FENCE_RE.test(raw)) {
            at(i, 'a fence on the same line as a list or blockquote marker is not supported. Put the fence on its own line, indented under the item.');
        } else if (FENCE_LINE_RE.test(line) && (quoted || /\t/.test(leading))) {
            at(i, quoted ? 'fences inside blockquotes are not supported. Move the fence out of the blockquote.' : 'fences must be indented with spaces, not tabs.');
        }
        if (/\t/.test(leading)) at(i, 'indent with spaces, not tabs (Markdown expands a tab to 4 columns).');
        if (INVISIBLE_RE.test(raw)) at(i, 'non-ASCII whitespace or an invisible character can disguise text. Use plain spaces and remove invisible characters.');
        if (afterDefinition && /^ {0,3}["'(]/.test(line)) at(i, 'a link reference definition must fit on one line (this line would be its hidden title).');
        afterDefinition = LINK_DEFINITION_RE.test(line);
        const prose = proseOf(line);
        if (prose === null) {
            at(i, 'a backtick code span is not closed on the same line. Close it on this line, or escape the backtick as \\`.');
            return;
        }
        if (RAW_HTML_RE.test(prose.replace(AUTOLINK_RE, ' '))) {
            at(i, 'raw HTML is not supported in the specification (it can hide or change what renders). Use Markdown, or put it in a code span.');
        }
        if (ENTITY_RE.test(prose)) at(i, 'HTML entities (such as &#116;) can disguise text. Write the character itself.');
        if (unclosedLink(prose)) at(i, 'an inline link or image is not closed on this line; its title would hide the lines after it.');
        if (afterDefinition) {
            if (!COMPLETE_DEFINITION_RE.test(line)) at(i, 'a link reference definition must fit on one line.');
            if (STRUCTURE_RE.test(line)) at(i, 'a link reference definition holds spec structure, which does not render. Remove it.');
        }
        const shape = skeleton(line);
        for (const field of FIELD_LIKE) {
            if (!shape.startsWith(field.key)) continue;
            counts[field.name]++;
            if (!field.exact.test(line) || quoted) at(i, `write the ${field.name} line exactly as in the template ("${field.name === 'Status' ? '**Status:** <value>' : `* **${field.name}:**`}" at the start of the line, outside blockquotes).`);
        }
        const trimmed = line.trim();
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

module.exports = {
    TASK_RE, LIST_ITEM_RE, FIELD_LIKE, indentOf, isBlank, stripQuote, skeleton, commentLines, uncommented, unquoted, visibleLines,
    ambiguousMarkup
};
