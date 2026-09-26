// The spec parser follows a strict Markdown subset; everything outside it is an error.
// Each case here rendered differently on GitHub than the parser read it (a hidden
// unchecked task or a swapped Status) before the subset was enforced.
const test = require('node:test');
const assert = require('node:assert');
const { parseSpec, withTaskEvidence } = require('../scripts/lib/spec');
const { lintLiteSpec } = require('../scripts/check-spec');
const { TEMPLATE, spec } = require('./spec-fixtures');

const lint = text => lintLiteSpec(text).problems.join('\n');
const recorded = (text, id, transcript) => withTaskEvidence(text, id, { date: '2026-09-25', exit: '0', transcript });

test('R21: a fence left open in a list item does not swallow the next task', () => {
    const text = recorded(spec({ status: 'Draft' }), 'T1', 'done')
        .replace('* [ ] **T2:**', '  ```\n* [ ] **T2:**');
    assert.match(lint(text), /indented less than its opening fence/);
    // A lazy continuation line moves the fence into the list item, which then ends it.
    const lazy = '* [x] **T3:** done\n**Status:** Draft\n  ```\n  * [ ] **T4:** nested\nplain\n   * [ ] **T9:** three\n';
    assert.match(lint(lazy), /indented less than its opening fence|never closed/);
});

test('R21: a fence inside a raw HTML block is not a fence', () => {
    const text = spec({ status: 'Draft' }) + '\n<div>\n```\n</div>\n\n* [ ] **T9:** hidden\n\n<div>\n```\n</div>\n';
    assert.match(lint(text), /raw HTML is not supported/);
});

test('R22: tab indentation is rejected, so a tab-indented fence cannot hide tasks', () => {
    const text = spec({ status: 'Draft' }) + '\n\t```\n* [ ] **T9:** open\n\t```\n';
    assert.match(lint(text), /fences must be indented with spaces, not tabs/);
    assert.match(lint(spec({ status: 'Draft' }) + '\n\t* [ ] **T9:** nested with a tab\n'), /indent with spaces, not tabs/);
});

test('R23: a closing fence indented 4+ spaces does not close the block', () => {
    const text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed',
        '```\n    ```\n**Status:** Draft\n```\n\n**Status:** Completed\n\n    ```');
    assert.match(lint(text), /closing fence is indented 4 spaces/);
});

test('R24: escaped backticks do not make a code span; an unpaired backtick is an error', () => {
    const text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed',
        'Intro \\`<!--\\`\n**Status:** Draft\n-->\n\n**Status**: Completed');
    const problems = lint(text);
    assert.match(problems, /raw HTML is not supported/);
    assert.match(problems, /write the Status line exactly as in the template/);
    assert.match(lint(spec({ status: 'Draft' }) + '\nA `code span that never closes\n'), /code span is not closed on the same line/);
});

test('R25: link reference definitions must fit on one line; Status variants are errors', () => {
    const text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed',
        "[a]: /u '\n**Status:** Draft\n'\n\n **Status:** Completed");
    const problems = lint(text);
    assert.match(problems, /link reference definition must fit on one line/);
    assert.match(problems, /write the Status line exactly/);
    for (const variant of [' **Status:** Completed', '__Status:__ Completed', 'Status: Completed', '\\*\\*Status:\\*\\* Completed']) {
        assert.match(lint(spec({ status: 'Draft' }) + `\n${variant}\n`), /write the Status line exactly/, variant);
    }
    assert.doesNotMatch(lint(spec({ status: 'Draft' }) + '\n[docs]: https://example.com "Docs"\n'), /link reference/);
});

test('R26: gate fields appear exactly once; look-alike tasks are errors', () => {
    const doubled = spec({ status: 'Draft' }) + '\n* **Verification Command:**\n  ```bash\n  true\n  ```\n';
    assert.match(lint(doubled), /2 "Verification Command" lines/);
    assert.match(lint(spec({ status: 'Draft' }) + '\n*[ ] **T9:** no space after the marker\n'), /looks like a task but is not a list item/);
});

test('legitimate specs stay valid: template, recorded evidence with any content, numbered and nested lists', () => {
    assert.strictEqual(lint(TEMPLATE), '');
    const transcript = '$ cat notes.md\n```js\nx\n```\n~~~\n<!-- not a comment -->\n<script>alert(1)</script>\n\ttabbed output';
    let text = recorded(spec({ status: 'Draft' }), 'T1', transcript);
    text += '\n## 6. More\n\n1. [ ] **T4:** numbered\n   * [ ] **T5:** nested\n     * [ ] **T6:** deeper\n10. [ ] **T7:** two-digit marker\n';
    text = recorded(recorded(text, 'T4', 'ok'), 'T7', 'ok');
    assert.strictEqual(lint(text), '');
    const tasks = parseSpec(text).tasks;
    assert.deepStrictEqual(tasks.filter(t => t.checked).map(t => [t.id, t.evidence.recorded.intact]), [['T1', true], ['T4', true], ['T7', true]]);
    // Evidence is added at the end of the task's block, at the item's content column.
    assert.match(text, /\n {5}\* \[ \] \*\*T6:\*\* deeper\n {3}\* \*\*Evidence:\*\* sdd-verify/, 'numbered item: column 3');
    assert.match(text, /\n10\. \[x\] \*\*T7:\*\* two-digit marker\n {4}\* \*\*Evidence:\*\* sdd-verify/);
});

test('R27: HTML comments start at column 0, and every fence is closed', () => {
    const indented = '* [ ] **T10:** plus\nplain text\n  <!--\n</div>\n<!-- x -->\n* [x] **T3:** done\n**Status:** Completed\n';
    assert.match(lint(indented), /HTML comments are supported only at the top level, starting at column 0/);
    assert.match(lint(spec({ status: 'Draft' }) + '\n```\n* [ ] **T9:** swallowed\n'), /A fence is never closed/);
    assert.strictEqual(lint(spec({ status: 'Draft' }) + '\n<!-- a note\nover two lines -->\n'), '');
});
