; Swift: struct, class, enum, actor and extension are all class_declaration (the keyword says which); protocols; functions.
(class_declaration name: (type_identifier) @name) @definition.class
(class_declaration name: (user_type (type_identifier) @name)) @definition.class
(protocol_declaration name: (type_identifier) @name) @definition.interface
(function_declaration name: (simple_identifier) @name) @definition.function
(protocol_function_declaration name: (simple_identifier) @name) @definition.function
(typealias_declaration name: (type_identifier) @name) @definition.type
(property_declaration name: (pattern bound_identifier: (simple_identifier) @name)) @definition.variable

(call_expression (simple_identifier) @name) @reference.call
(call_expression (navigation_expression suffix: (navigation_suffix suffix: (simple_identifier) @name))) @reference.call
(user_type (type_identifier) @name) @reference.type
