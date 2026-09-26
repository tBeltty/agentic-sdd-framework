/**
 * scripts/lib/spec-markup.js
 *
 * Reads the Lite specification the way it renders: the Markdown is parsed with a CommonMark
 * parser (markdown-it, vendored in ./vendor), and tasks, fields, and the verification gate
 * are taken from the token tree, so a line counts only if it renders as what it claims to be.
 *
 * A thin subset is enforced on top, for the places where GitHub's renderer (cmark-gfm) and
 * markdown-it could still differ, and for text that can be disguised:
 *   - no raw HTML (HTML comments included), no link reference definitions or footnotes;
 *   - no HTML entities, invisible characters, or non-ASCII whitespace outside code;
 *   - indentation with spaces, not tabs, outside code;
 *   - Status, Verification Command, Expected Output and Last Verified are written exactly as
 *     in the template; any other line that reads as one of them (the name followed by a
 *     colon, or the name emphasized, at the start of a line, compared after folding case,
 *     punctuation, and look-alike letters) is an error, as is text that reads as a task
 *     checkbox without being one.
 *   - a line right after a list item, indented 4 or more spaces but fewer than that item's
 *     own content column, and starting with ">", "#", or a fence: markdown-it and cmark-gfm
 *     can disagree on whether it continues the item's last paragraph or opens indented code.
 * Code (fenced or indented) is verbatim and never checked against these rules.
 */

const MarkdownIt = require('./vendor/markdown-it.min.js');

const md = new MarkdownIt('default', { html: true, linkify: false });
// Keep entities and escapes as separate tokens (text_join would merge them into plain text
// and hide that an entity was used).
md.core.ruler.disable('text_join');

const BOM = '\uFEFF';
// Non-ASCII whitespace, form feed and vertical tab, and invisible or bidirectional
// formatting characters.
const INVISIBLE_RE = /[\f\v\u00A0\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u1680\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFEFF\uFFA0]/;
// Letters that look like Latin ones (Cyrillic, Greek, Armenian, IPA, small capitals), and
// colon look-alikes, folded before comparing.
const CONFUSABLES = new Map(Object.entries({
    '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0455': 's',
    '\u0456': 'i', '\u0458': 'j', '\u0501': 'd', '\u04CF': 'l', '\u0442': 't', '\u0432': 'b', '\u043A': 'k', '\u043C': 'm',
    '\u043D': 'h', '\u057D': 'u', '\u03C5': 'u', '\u03C4': 't', '\u03B9': 'i', '\u03BF': 'o', '\u03B1': 'a', '\u03BD': 'v',
    '\u03BA': 'k', '\u03C1': 'p', '\u03B5': 'e', '\u0251': 'a', '\u0261': 'g', '\u0131': 'i', '\u0237': 'j', '\u0269': 'i',
    '\u028F': 'y', '\u1D1B': 't', '\uA731': 's', '\u1D1C': 'u', '\u1D00': 'a', '\u1D07': 'e', '\u1D0F': 'o', '\u0280': 'r',
    '\u02D0': ':', '\uA789': ':', '\u0589': ':', '\u2236': ':', '\u02F8': ':', '\u05C3': ':', '\u0703': ':', '\u0704': ':'
}));
// A text reduced to lowercase ASCII letters, digits and colons, look-alikes folded.
const skeleton = text => [...text.normalize('NFKC').toLowerCase()].map(c => CONFUSABLES.get(c) || c).join('').replace(/[^a-z0-9:]/g, '');

const FIELDS = [
    { name: 'Status', key: 'status' },
    { name: 'Verification Command', key: 'verificationcommand' },
    { name: 'Expected Output', key: 'expectedoutput' },
    { name: 'Last Verified', key: 'lastverified' }
];
const LIST_ITEM_RE = /^( *)([*+-]|\d{1,9}[.)])( {1,4}|$)/;
const CHECKBOX_RE = /^\[([ xX])\](?=[ \t]|$)/;
// A footnote definition at the start of a line, after any blockquote or list markers.
const FOOTNOTE_RE = /^(?:[ \t]*(?:>|[*+-]|\d{1,9}[.)])?)*[ \t]*\[\^[^\]]*\]:/;
const RAW_HTML = 'raw HTML (HTML comments included) is not supported in the specification: it can hide or change what renders. Use Markdown, or put it in a code span.';
const TABLE_NOT_SUPPORTED = 'GFM tables are not supported in the specification. Use a list instead.';

// Nests the flat token stream: every *_open token becomes a node holding its children.
function tokenTree(tokens) {
    const root = { type: 'root', children: [], parent: null };
    let current = root;
    for (const token of tokens) {
        if (token.nesting === 1) {
            const node = { type: token.type.replace(/_open$/, ''), token, children: [], parent: current };
            current.children.push(node);
            current = node;
        } else if (token.nesting === -1) {
            current = current.parent;
        } else {
            current.children.push({ type: token.type, token, children: [], parent: current });
        }
    }
    return root;
}

function* walk(node) {
    for (const child of node.children) {
        yield child;
        yield* walk(child);
    }
}

function inside(node, types) {
    for (let p = node.parent; p; p = p.parent) if (types.includes(p.type)) return true;
    return false;
}

// The rendered text of an inline token, one entry per rendered line, with the text of an
// emphasis that opens the line (null when the line does not open with one).
function renderedLines(inline) {
    const lines = [{ text: '', emphasis: null }];
    let depth = 0;
    let started = false;
    for (const child of inline.children || []) {
        const line = lines[lines.length - 1];
        if (child.type === 'softbreak' || child.type === 'hardbreak') {
            lines.push({ text: '', emphasis: null });
            depth = 0;
            started = false;
        } else if (/^(strong|em|s)_open$/.test(child.type)) {
            if (!started && depth === 0) line.emphasis = '';
            depth++;
        } else if (/^(strong|em|s)_close$/.test(child.type)) {
            depth = Math.max(0, depth - 1);
            if (depth === 0) started = true;
        } else {
            const text = child.content || '';
            if (line.emphasis !== null && depth > 0 && !started) line.emphasis += text;
            if (depth === 0 && text.trim() !== '') started = true;
            line.text += text;
        }
    }
    return lines;
}

// The field a rendered line reads as, if any. A checkbox literal ("[x] ", "[ ] ") at the
// start is stripped first: its letter (the "x" of a checked box) would otherwise land in
// the skeleton and hide a task whose title reads as a field, such as "[x] **Status:** ...".
function fieldOf({ text, emphasis }) {
    const shape = skeleton(text.replace(/^\[[ xX]\]\s*/, ''));
    return FIELDS.find(f => shape.startsWith(`${f.key}:`) || (emphasis !== null && skeleton(emphasis).startsWith(f.key))) || null;
}

function firstInline(item) {
    const first = item.children[0];
    return first && first.type === 'paragraph' ? first.children.find(c => c.type === 'inline') : null;
}

function firstCode(node) {
    for (const child of walk(node)) if (child.type === 'fence' || child.type === 'code_block') return child.token;
    return null;
}

const codeText = token => token.content.replace(/\n$/, '');

// Trims trailing blank lines from a [start, end) line range.
function trimRange([start, end], lines) {
    let stop = end;
    while (stop > start + 1 && /^[ \t]*$/.test(lines[stop - 1] || '')) stop--;
    return [start, stop];
}

// The column where a list item's own content starts: past every list marker at the start of
// its first line. Usually one marker, but a list can start nested on the same source line
// ("* * ...", "1. - ..."), so every marker up to the content is consumed, not only the first.
function contentColumn(line) {
    let column = 0;
    let rest = line;
    let marker;
    while ((marker = rest.match(LIST_ITEM_RE))) {
        const consumed = marker[1].length + marker[2].length + (marker[3] ? marker[3].length : 1);
        column += consumed;
        rest = rest.slice(consumed);
    }
    return column;
}

// A line indented 4 or more spaces but fewer than the content column of the list item that
// ends right before it, and that would start a blockquote, heading, or fenced code once its
// indentation is read as one of those (rather than as part of the code that indentation would
// otherwise open): cmark-gfm reads it as continuing that item's last paragraph (lazy
// continuation); markdown-it reads it as indented code, ending the item there instead. Every
// case the tenth review found this way hid a task or swapped the verification command, so it
// is rejected rather than guessed at either way.
const AMBIGUOUS_CONTINUATION_RE = /^(?:>|#|```|~~~)/;
function checkAmbiguousContinuations(tree, lines, at) {
    const flagged = new Set();
    for (const node of walk(tree)) {
        if (node.type !== 'list_item' || !node.token.map) continue;
        const boundary = node.token.map[1];
        if (boundary >= lines.length || flagged.has(boundary)) continue;
        const line = lines[boundary];
        const indent = (line.match(/^ */) || [''])[0].length;
        const column = contentColumn(lines[node.token.map[0]]);
        if (indent < 4 || indent >= column || !AMBIGUOUS_CONTINUATION_RE.test(line.slice(indent))) continue;
        flagged.add(boundary);
        at(boundary, `this line is indented ${indent} space(s): less than the ${column} the list item above needs for its own content, but 4 or more. GitHub and the parser can disagree on whether it continues that item or starts indented code. Indent it to column ${column} to keep it in the item, or under 4 spaces to end the item.`);
    }
}

// The line of the first list item nested under `node` (at any depth) that is itself a
// task, or null. A task nested under the Evidence item (indented to its content column) is
// not part of the evidence: it must keep its own place when evidence is rewritten.
function firstNestedTaskLine(node) {
    for (const child of walk(node)) {
        if (child.type !== 'inline') continue;
        const paragraph = child.parent.type === 'paragraph' ? child.parent : null;
        const li = paragraph && paragraph.parent.type === 'list_item' && paragraph.parent.children[0] === paragraph ? paragraph.parent : null;
        if (li && li !== node && CHECKBOX_RE.test(child.token.content)) return li.token.map[0];
    }
    return null;
}

function readTask(item, inline, lines) {
    const [, mark] = inline.content.match(CHECKBOX_RE);
    const rest = inline.content.replace(CHECKBOX_RE, '').split('\n')[0].trim();
    const bold = rest.match(/^\*\*([A-Za-z0-9_.-]+):\*\*\s*(.*)$/);
    const range = trimRange(item.token.map, lines);
    const task = {
        id: bold ? bold[1] : `line ${range[0] + 1}`,
        line: range[0],
        checked: mark !== ' ',
        title: (bold ? bold[2] : rest).trim(),
        evidence: { header: '', text: '', code: null, range: null },
        quoted: inside(item, ['blockquote']),
        blockEnd: range[1]
    };
    // Evidence: the first item of the task's own sub-lists whose text starts with the label.
    for (const list of item.children.filter(c => c.type === 'bullet_list' || c.type === 'ordered_list')) {
        const evidence = list.children.find(sub => {
            const first = firstInline(sub);
            return first && /^\*\*Evidence:\*\*/.test(first.token.content);
        });
        if (!evidence) continue;
        // A task nested under Evidence (see firstNestedTaskLine) ends the evidence's own
        // content: its text, code and range stop there, so rewriting evidence cannot delete it.
        const nestedTaskLine = firstNestedTaskLine(evidence);
        const ownEnd = nestedTaskLine !== null ? nestedTaskLine : evidence.token.map[1];
        const first = firstInline(evidence).token;
        const [head, ...more] = first.content.split('\n');
        const header = head.replace(/^\*\*Evidence:\*\*/, '').trim();
        const text = [header, ...more];
        let code = null;
        for (const node of walk(evidence)) {
            if (!node.token || !node.token.map || node.token.map[0] >= ownEnd) continue;
            if (node.type === 'inline' && node.token !== first) text.push(node.token.content);
            if (node.type === 'fence' || node.type === 'code_block') {
                text.push(codeText(node.token));
                if (code === null) code = node.token;
            }
        }
        task.evidence = {
            header,
            text: text.filter(t => t.trim() !== '').join('\n').trim(),
            code: code ? codeText(code) : null,
            range: trimRange([evidence.token.map[0], ownEnd], lines)
        };
        break;
    }
    return task;
}

/*
 * The specification as it renders: tasks with their evidence, the lines that read as
 * fields, and the problems found by the subset checks. `lines` are the normalized source
 * lines (LF; a BOM stays on line 0 so line numbers match the file).
 */
function readDocument(lines) {
    const env = {};
    const tree = tokenTree(md.parse(lines.join('\n').replace(/^\uFEFF/, ''), env));
    const problems = [];
    const at = (line, what) => problems.push(`Line ${line + 1}: ${what}`);

    // Code is verbatim: note its lines so the source checks skip them. Tabs are still
    // checked where they decide the code's own indentation (fence lines, the columns a fence
    // strips from its content, the margin of indented code), since renderers expand them
    // differently there.
    const code = new Set();
    const tabbed = 'a tab decides the indentation of this code block, which renderers expand differently. Indent with spaces.';
    for (const node of walk(tree)) {
        if ((node.type !== 'fence' && node.type !== 'code_block') || !node.token.map) continue;
        const [first, end] = node.token.map;
        for (let i = first; i < end; i++) code.add(i);
        if (node.type === 'code_block') {
            for (let i = first; i < end; i++) if (/^[ >]*\t/.test(lines[i])) at(i, tabbed);
            continue;
        }
        const indent = lines[first].match(/^[ >]*/)[0].length;
        if (/^[ >]*\t/.test(lines[first]) || /^[ >]*\t/.test(lines[end - 1] || '')) at(first, tabbed);
        for (let i = first + 1; i < end - 1; i++) if (lines[i].slice(0, indent).includes('\t')) at(i, tabbed);
        // An unclosed fence runs to the end of its container (CommonMark, not an error there),
        // but the template requires closed fences: later lines (a field, a task) would silently
        // become its content instead of rendering as themselves.
        const ch = node.token.markup[0];
        const closeRe = new RegExp(`^[ >]*${ch === '`' ? '`' : '~'}{${node.token.markup.length},}[ \\t]*$`);
        if (!closeRe.test(lines[end - 1] || '')) at(first, 'this fenced code block has no closing fence: it runs to the end of its container, and later lines are read as its content. Close it with a matching fence.');
    }
    lines.forEach((line, i) => {
        if (code.has(i)) return;
        const text = i === 0 && line.startsWith(BOM) ? line.slice(1) : line;
        if (/^[ >]*\t/.test(text)) at(i, 'indent with spaces, not tabs (Markdown expands a tab to 4 columns).');
        if (INVISIBLE_RE.test(text)) at(i, 'non-ASCII whitespace or an invisible character can disguise text. Use plain spaces and remove invisible characters.');
        // GitHub's footnotes can interrupt a paragraph, where markdown-it reads plain text.
        if (FOOTNOTE_RE.test(text)) at(i, 'footnotes are not supported (GitHub and the parser read them differently). Use an inline link or a sentence.');
    });
    const references = Object.keys(env.references || {});
    if (references.length > 0) {
        problems.push(`Link reference definitions and footnotes are not supported (they render nothing and can hide lines): ${references.map(r => `[${r}]`).join(', ')}. Use inline links: [text](url).`);
    }
    checkAmbiguousContinuations(tree, lines, at);

    const tasks = [];
    const fieldLines = [];
    for (const node of walk(tree)) {
        if (node.type === 'html_block') at(node.token.map[0], RAW_HTML);
        // Table cells have no source map (their content can span or be split across the
        // row's source line), so they cannot be tied to a line: reject tables instead of
        // guessing at one.
        if (node.type === 'table') at(node.token.map[0], TABLE_NOT_SUPPORTED);
        if (node.type !== 'inline') continue;
        const inline = node.token;
        if (!inline.map) continue;
        const start = inline.map[0];
        for (const child of inline.children || []) {
            if (child.type === 'html_inline') at(start, RAW_HTML);
            if (child.info === 'entity') at(start, `HTML entities (such as ${child.markup}) can disguise text. Write the character itself.`);
        }
        const paragraph = node.parent.type === 'paragraph' ? node.parent : null;
        const item = paragraph && paragraph.parent.type === 'list_item' && paragraph.parent.children[0] === paragraph ? paragraph.parent : null;
        const isTask = Boolean(item) && CHECKBOX_RE.test(inline.content);
        const sourceLines = inline.content.split('\n');
        renderedLines(inline).forEach((rendered, k) => {
            const field = fieldOf(rendered);
            if (field) fieldLines.push({ field, node, item: k === 0 ? item : null, line: start + k, source: (sourceLines[k] || '').trimEnd(), rendered });
            // A list marker can precede the checkbox here too ("* [ ] ..."), not just the
            // checkbox alone: an over-indented line following a blockquote or list item can
            // render as continuation text that still reads as a whole task, marker included.
            if (!(isTask && k === 0) && /^\s*(?:[*+-]|\d{1,9}[.)])?\s*\[[ xX]\]/.test(rendered.text)) {
                at(start + k, 'this reads as a task checkbox but is not the first line of a list item ("* [ ] **T1:** ..."), so it is not a task. Fix the list marker or remove the brackets.');
            }
        });
        if (isTask) tasks.push(readTask(item, inline, lines));
    }
    return { tree, tasks, fieldLines, problems };
}

// The "Verification Gate" section: its top-level nodes and its [from, to) line range.
function gateSection(tree, lines) {
    const top = tree.children;
    const heading = n => n.type === 'heading';
    const start = top.findIndex(n => heading(n) && n.token.tag === 'h2'
        && /^(?:\d+\.\s*)?Verification Gate\b/i.test(n.children[0].token.content));
    if (start === -1) return null;
    let end = top.findIndex((n, i) => i > start && heading(n) && Number(n.token.tag.slice(1)) <= 2);
    if (end === -1) end = top.length;
    return {
        nodes: top.slice(start + 1, end),
        from: top[start].token.map[0],
        to: end < top.length ? top[end].token.map[0] : lines.length
    };
}

module.exports = { LIST_ITEM_RE, FIELDS, skeleton, readDocument, gateSection, firstCode, codeText, walk, inside };
