; TypeScript (and TSX): what a file defines and what it points at.
; Captures: @definition.<kind> on the whole declaration, @name on its name; @reference.<kind> on the use, @name on the name used.
; The code (extract.ts) decides what is top level, what is exported and what a method belongs to.

; ---- definitions
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(function_signature name: (identifier) @name) @definition.function
(class_declaration name: (type_identifier) @name) @definition.class
(abstract_class_declaration name: (type_identifier) @name) @definition.class
(interface_declaration name: (type_identifier) @name) @definition.interface
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum
(internal_module name: (identifier) @name) @definition.module
(internal_module name: (nested_identifier) @name) @definition.module
(module name: (string) @name) @definition.module
(variable_declarator name: (identifier) @name) @definition.variable
(method_definition name: (property_identifier) @name) @definition.method
(method_definition name: (private_property_identifier) @name) @definition.method
(abstract_method_signature name: (property_identifier) @name) @definition.method
(public_field_definition name: (property_identifier) @name value: (arrow_function)) @definition.method
(public_field_definition name: (property_identifier) @name value: (function_expression)) @definition.method

; ---- references
(call_expression function: (identifier) @name) @reference.call
(call_expression function: (member_expression property: (property_identifier) @name)) @reference.call
(new_expression constructor: (identifier) @name) @reference.class
(new_expression constructor: (member_expression property: (property_identifier) @name)) @reference.class
(type_identifier) @name @reference.type
(nested_type_identifier name: (type_identifier) @name) @reference.type
(extends_clause value: (identifier) @name) @reference.implementation
(decorator (identifier) @name) @reference.call
(decorator (call_expression function: (identifier) @name)) @reference.call

; ---- exports: `export default x`, `export { a as b }`, and CommonJS
(export_statement) @export
(expression_statement (assignment_expression left: (member_expression object: (identifier) @_o property: (property_identifier) @name) right: (_) @value (#eq? @_o "exports"))) @definition.cjs
(expression_statement (assignment_expression left: (member_expression object: (member_expression object: (identifier) @_m property: (property_identifier) @_e) property: (property_identifier) @name) right: (_) @value (#eq? @_m "module") (#eq? @_e "exports"))) @definition.cjs
(expression_statement (assignment_expression left: (member_expression object: (identifier) @_m property: (property_identifier) @_e) right: (_) @value (#eq? @_m "module") (#eq? @_e "exports"))) @cjs.root
