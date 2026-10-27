; PHP: classes, interfaces, traits, enums, functions, methods and constants; calls and instantiations.
(class_declaration name: (name) @name) @definition.class
(interface_declaration name: (name) @name) @definition.interface
(trait_declaration name: (name) @name) @definition.trait
(enum_declaration name: (name) @name) @definition.enum
(function_definition name: (name) @name) @definition.function
(method_declaration name: (name) @name) @definition.method
(const_declaration (const_element (name) @name)) @definition.const

(function_call_expression function: (name) @name) @reference.call
(member_call_expression name: (name) @name) @reference.call
(scoped_call_expression name: (name) @name) @reference.call
(object_creation_expression (name) @name) @reference.class
(base_clause (name) @name) @reference.implementation
(class_interface_clause (name) @name) @reference.implementation
