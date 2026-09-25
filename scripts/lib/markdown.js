/**
 * scripts/lib/markdown.js
 *
 * Minimal Markdown helpers shared by the prose linter and the spec parser.
 */

// Normalizes CRLF/CR line endings so line-anchored regexes behave the same on Windows.
function normalizeEol(text) {
    return text.replace(/\r\n?/g, '\n');
}

function detectEol(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

// Tracks fenced code blocks. A fence closes only with the same character repeated at
// least as many times as the opening fence, and nothing else on the line (CommonMark).
// Any indentation is accepted because fences nested in list items are indented.
function createFenceTracker() {
    let open = null;
    return {
        get inside() {
            return open !== null;
        },
        // Returns true when the line is a fence delimiter (opening or closing).
        update(line) {
            const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
            if (!match) return false;
            const [, marker, rest] = match;
            if (open === null) {
                if (marker[0] === '`' && rest.includes('`')) return false;
                open = marker;
                return true;
            }
            if (marker[0] === open[0] && marker.length >= open.length && rest.trim() === '') {
                open = null;
                return true;
            }
            return false;
        }
    };
}

module.exports = { normalizeEol, detectEol, createFenceTracker };
