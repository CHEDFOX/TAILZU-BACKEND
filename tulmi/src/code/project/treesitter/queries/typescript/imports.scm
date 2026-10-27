; TypeScript and JavaScript: the modules a file reads. @source is the specifier without its quotes.
(import_statement source: (string (string_fragment) @source)) @import
(export_statement source: (string (string_fragment) @source)) @import
(call_expression function: (identifier) @_f arguments: (arguments . (string (string_fragment) @source)) (#eq? @_f "require")) @import
(call_expression function: (import) arguments: (arguments . (string (string_fragment) @source))) @import
(import_require_clause source: (string (string_fragment) @source)) @import
