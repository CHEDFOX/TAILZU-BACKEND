; JSX: a capitalised tag is a component used; <Button /> points at Button. (Added to the TSX and JavaScript tag queries.)
(jsx_opening_element name: (identifier) @name (#match? @name "^[A-Z]")) @reference.component
(jsx_self_closing_element name: (identifier) @name (#match? @name "^[A-Z]")) @reference.component
(jsx_opening_element name: (member_expression property: (property_identifier) @name (#match? @name "^[A-Z]"))) @reference.component
(jsx_self_closing_element name: (member_expression property: (property_identifier) @name (#match? @name "^[A-Z]"))) @reference.component
