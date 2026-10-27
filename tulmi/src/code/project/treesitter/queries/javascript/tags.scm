; JavaScript (and JSX): what a file defines and what it points at. Same captures as typescript/tags.scm.

; ---- definitions
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (identifier) @name) @definition.class
(variable_declarator name: (identifier) @name) @definition.variable
(method_definition name: (property_identifier) @name) @definition.method
(method_definition name: (private_property_identifier) @name) @definition.method
(field_definition property: (property_identifier) @name value: (arrow_function)) @definition.method
(field_definition property: (property_identifier) @name value: (function_expression)) @definition.method

; ---- references
(call_expression function: (identifier) @name) @reference.call
(call_expression function: (member_expression property: (property_identifier) @name)) @reference.call
(new_expression constructor: (identifier) @name) @reference.class
(new_expression constructor: (member_expression property: (property_identifier) @name)) @reference.class
(class_heritage (identifier) @name) @reference.implementation

; ---- exports: `export default x`, `export { a as b }`, and CommonJS
(export_statement) @export
(expression_statement (assignment_expression left: (member_expression object: (identifier) @_o property: (property_identifier) @name) right: (_) @value (#eq? @_o "exports"))) @definition.cjs
(expression_statement (assignment_expression left: (member_expression object: (member_expression object: (identifier) @_m property: (property_identifier) @_e) property: (property_identifier) @name) right: (_) @value (#eq? @_m "module") (#eq? @_e "exports"))) @definition.cjs
(expression_statement (assignment_expression left: (member_expression object: (identifier) @_m property: (property_identifier) @_e) right: (_) @value (#eq? @_m "module") (#eq? @_e "exports"))) @cjs.root
