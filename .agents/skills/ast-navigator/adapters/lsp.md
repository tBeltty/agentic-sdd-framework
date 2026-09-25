# Adapter: Language Server Protocol (LSP) / SCIP

* **Upstream Organization:** SCIP Code (`@scip-code`), originally created by Sourcegraph
* **Repository:** [https://github.com/scip-code/scip](https://github.com/scip-code/scip)
* **License:** Apache License 2.0
* **Runtime Requirement:** Language-specific indexers (`scip-typescript`, `scip-go`, etc.)

## Capabilities and Mechanics
SCIP (Source Code Intelligence Protocol) indexes definitions, references, and hover types across strongly typed codebases. It enables exact compiler-level cross-file navigation without heuristics.

## Common Operational Commands
* **Index Project:** `scip-typescript index`
* **Query References:** Query through SCIP CLI or LSP client interfaces.

## Best Practices
* Use in large enterprise repositories where type relationships and cross-package references must be verified with compiler precision.
