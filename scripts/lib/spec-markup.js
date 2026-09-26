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

// HTML comments are outside the supported subset (they are reported as raw HTML), so no
// line is ever treated as hidden: the parser reads every line the author wrote.
function commentLines(lines) {
    return lines.map(() => false);
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
 *   - no raw HTML outside code, HTML comments included (a URL is linked as plain text);
 *   - no link reference definitions or footnotes (use inline links), and a line that starts
 *     with "[" closes it on the same line;
 *   - no HTML entities, non-ASCII whitespace, or invisible characters outside code, and no
 *     link title that spans lines (all can hide or disguise text);
 *   - Status, Verification Command, Expected Output and Last Verified appear in their exact
 *     form; lines that only resemble them are errors: the field name followed by a colon, or
 *     emphasized, at the start of a line or list item, compared after folding case,
 *     punctuation, and look-alike letters.
 */
const LIST_ITEM_RE = /^( *)([*+-]|\d{1,9}[.)])( {1,4}|$)/;
const ESCAPABLE_RE = /[!-/:-@[-`{-~]/;
const RAW_HTML_RE = /<(?:[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|\/[A-Za-z]|!|\?)/;
// A link reference definition or footnote ("[x]: url", "[^1]: note") at the start of a line.
const DEFINITION_RE = /^ {0,3}(?:\[\^|\[[^\]]*\]:)/;
const LIST_MARKERS_RE = /^(?: *(?:[*+-]|\d{1,9}[.)])[ \t]+)+/;
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

// True when a line reads as the field `key` ("status", "verificationcommand", ...): the name
// followed by a colon, or the name emphasized, at the start of the line or of a list item.
function looksLikeField(line, key) {
    const body = line.replace(LIST_MARKERS_RE, '');
    if (skeleton(body).startsWith(`${key}:`)) return true;
    const emphasized = body.match(/^([*_~]{1,3})(.+?)\1/);
    return Boolean(emphasized) && skeleton(emphasized[2]).startsWith(key);
}

// True when a line starts with "[" that is not closed on it (a label that spans lines).
function unclosedLeadingBracket(prose) {
    if (!/^ {0,3}\[/.test(prose)) return false;
    let depth = 0;
    for (const ch of prose) {
        if (ch === '[') depth++;
        else if (ch === ']' && --depth === 0) return false;
    }
    return true;
}
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
    const counts = Object.fromEntries(FIELD_LIKE.map(f => [f.name, 0]));
    lines.forEach((raw, i) => {
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
        const prose = proseOf(line);
        if (prose === null) {
            at(i, 'a backtick code span is not closed on the same line. Close it on this line, or escape the backtick as \\`.');
            return;
        }
        if (RAW_HTML_RE.test(prose)) {
            at(i, 'raw HTML (HTML comments included) is not supported in the specification: it can hide or change what renders. Use Markdown, or put it in a code span.');
        }
        if (ENTITY_RE.test(prose)) at(i, 'HTML entities (such as &#116;) can disguise text. Write the character itself.');
        if (unclosedLink(prose)) at(i, 'an inline link or image is not closed on this line; its title would hide the lines after it.');
        if (DEFINITION_RE.test(prose) || unclosedLeadingBracket(prose)) {
            at(i, 'link reference definitions and footnotes are not supported (they render nothing and can hide lines). Use an inline link: [text](url).');
        }
        for (const field of FIELD_LIKE) {
            if (!looksLikeField(line, field.key)) continue;
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
