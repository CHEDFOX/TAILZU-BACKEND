; Kotlin / Ktor: get("/x") { ... } inside routing { }. Spring annotations are the same as Java's.
(call_expression
  (simple_identifier) @verb
  (call_suffix (value_arguments (value_argument (string_literal) @path)))
  (#match? @verb "^(get|post|put|patch|delete|head|options)$")) @route
