; Go: functions, methods (the receiver names the type), types, constants and variables; calls and types used.
(function_declaration name: (identifier) @name) @definition.function
(method_declaration receiver: (parameter_list) @receiver name: (field_identifier) @name) @definition.method
(type_spec name: (type_identifier) @name type: (struct_type)) @definition.struct
(type_spec name: (type_identifier) @name type: (interface_type)) @definition.interface
(type_spec name: (type_identifier) @name) @definition.type
(type_alias name: (type_identifier) @name) @definition.type
(const_spec name: (identifier) @name) @definition.const
(var_spec name: (identifier) @name) @definition.const

(call_expression function: (identifier) @name) @reference.call
(call_expression function: (selector_expression field: (field_identifier) @name)) @reference.call
(composite_literal type: (type_identifier) @name) @reference.class
(composite_literal type: (qualified_type name: (type_identifier) @name)) @reference.class
(type_identifier) @name @reference.type
