# Vendored libraries

The framework has no npm dependencies; the scripts are copied into projects as they are. Libraries it needs are vendored here, unmodified.

| File | Source | Version | License | SHA-256 |
| :--- | :--- | :--- | :--- | :--- |
| `markdown-it.min.js` | `markdown-it/dist/markdown-it.min.js` from the npm package [markdown-it](https://github.com/markdown-it/markdown-it) | 14.3.2 | MIT (`markdown-it.LICENSE`) | `e32488403e2e565ac12a9669bfdf2b1b876eb0a5c84f8e0699884b562d18eb52` |

markdown-it parses the Lite specification (`scripts/lib/spec-markup.js`), so the quality gate reads tasks, the Status, and the verification command from the same CommonMark structure that renders.

To update, install the new version in a scratch directory, copy `dist/markdown-it.min.js` and `LICENSE` here, update this table, and run the test suite and `scripts/dev/fuzz-spec-markup.js`.
