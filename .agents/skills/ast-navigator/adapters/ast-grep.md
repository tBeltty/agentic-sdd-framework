# Adapter: ast-grep

* **Upstream Creator:** Herrington Darkholme (`@HerringtonDarkholme`)
* **Repository:** [https://github.com/ast-grep/ast-grep](https://github.com/ast-grep/ast-grep)
* **License:** MIT License
* **Runtime Requirement:** Native binary (Rust-powered, installable via `npm i -g @ast-grep/cli` or `brew install ast-grep`)

## Capabilities and Mechanics
ast-grep performs structural code searches and transformations using Tree-sitter syntax trees. Unlike plain regex, it matches syntax constructs regardless of formatting, indentation, or comments.

## Common Operational Commands
* **Search AST Pattern:** `sg run -p '$FUNCTION($$$ARGS)' -l typescript`
* **Find Class Definitions:** `sg run -p 'class $NAME extends $BASE { $$$ }'`
* **Scan Rules:** `sg scan` (executes pre-configured YAML linting rules).

## Best Practices
* Use for lightweight environments where Python dependencies are undesirable.
* Ideal for CI/CD structural rule enforcement and automated AST refactors.
