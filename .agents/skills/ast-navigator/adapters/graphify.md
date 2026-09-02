# Adapter: Graphify

* **Upstream Organization:** Graphify Labs (`@Graphify-Labs`)
* **Repository:** [https://github.com/Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)
* **License:** Apache License 2.0 / MIT
* **Runtime Requirement:** Python 3.10+ (`pip install graphifyy`)

## Capabilities and Mechanics
Graphify extracts relational knowledge graphs of symbols, imports, and calls across multi-language repositories, generating interactive visual graphs and structured JSON query outputs.

## Common Operational Commands
* **Update Graph:** `graphify update .` (or configured project script `npm run graph:update`).
* **Check Index Freshness:** `graphify check` (validates graph commit against git HEAD).
* **Query Symbol Path:** `graphify path <source-node> <target-node>`.
* **Explain Subgraph:** `graphify explain <symbol-name>`.

## Best Practices
* Always regenerate the graph after major refactors or file deletions.
* Exclude build noise directories (`dist/`, `build/`, `.venv/`) from the index.
