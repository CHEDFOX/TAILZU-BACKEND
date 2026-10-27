; JSX: what a person reads. @text is the words between tags, @literal a {"string"} child, @attr.name/@attr.value a title, placeholder, aria-label, alt or label.
(jsx_text) @text
(jsx_expression (string (string_fragment) @literal)) @literal.expression
(jsx_attribute (property_identifier) @attr.name (string (string_fragment) @attr.value) (#match? @attr.name "^(title|placeholder|aria-label|alt|label)$"))
(jsx_attribute (property_identifier) @attr.name (jsx_expression (string (string_fragment) @attr.value)) (#match? @attr.name "^(title|placeholder|aria-label|alt|label)$"))
(jsx_attribute (property_identifier) @attr.name (jsx_expression (template_string (string_fragment) @attr.value)) (#match? @attr.name "^(title|placeholder|aria-label|alt|label)$"))
