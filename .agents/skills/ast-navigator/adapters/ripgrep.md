# Adapter: ripgrep

* **Upstream Creator:** Andrew Gallant (`@BurntSushi`)
* **Repository:** [https://github.com/BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep)
* **License:** MIT License / UNLICENSE
* **Runtime Requirement:** Native binary (`rg`)

## Capabilities and Mechanics
ripgrep is an ultra-fast line-oriented search tool that respects `.gitignore` rules by default. It provides the universal baseline fallback when AST parsers cannot resolve a query or when searching non-code files (markdown, JSON, YAML).

## Common Operational Commands
* **Find Literal String:** `rg -F "exact_symbol_name"`
* **Case-Insensitive Search:** `rg -i "pattern"`
* **Filter by File Extension:** `rg "pattern" -g "*.ts"`
* **List Matching Files Only:** `rg -l "pattern"`

## Best Practices
* Always use `--type` or `-g` globs to restrict search scope when querying large repositories.
* Avoid dumping thousands of lines into agent context; pair with `head` or line count limits.
