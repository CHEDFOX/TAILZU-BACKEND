; Rust: actix/rocket attributes #[get("/x")], axum .route("/x", get(h)).
(attribute_item
  (attribute (identifier) @verb arguments: (token_tree . (string_literal (string_content) @path)))
  (#match? @verb "^(get|post|put|patch|delete|head|options)$")) @route
(call_expression
  function: (field_expression field: (field_identifier) @verb)
  arguments: (arguments . (string_literal (string_content) @path) . (call_expression function: (identifier) @method))
  (#eq? @verb "route")) @route.axum
