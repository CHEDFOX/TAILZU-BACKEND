; Kotlin (the grammar has no field names: a name is the first identifier child of its declaration).
(class_declaration (type_identifier) @name) @definition.class
(object_declaration (type_identifier) @name) @definition.class
(function_declaration (simple_identifier) @name) @definition.function
(type_alias (type_identifier) @name) @definition.type
(property_declaration (variable_declaration (simple_identifier) @name)) @definition.variable

(call_expression (simple_identifier) @name) @reference.call
(call_expression (navigation_expression (navigation_suffix (simple_identifier) @name))) @reference.call
(user_type (type_identifier) @name) @reference.type
