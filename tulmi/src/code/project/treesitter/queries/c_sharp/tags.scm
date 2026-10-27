; C#: types, methods, constructors and properties; calls and instantiations.
(class_declaration name: (identifier) @name) @definition.class
(record_declaration name: (identifier) @name) @definition.class
(struct_declaration name: (identifier) @name) @definition.struct
(interface_declaration name: (identifier) @name) @definition.interface
(enum_declaration name: (identifier) @name) @definition.enum
(method_declaration name: (identifier) @name) @definition.method
(namespace_declaration name: (_) @name) @definition.module

(invocation_expression function: (identifier) @name) @reference.call
(invocation_expression function: (member_access_expression name: (identifier) @name)) @reference.call
(object_creation_expression type: (identifier) @name) @reference.class
(base_list (identifier) @name) @reference.implementation
(attribute name: (identifier) @name) @reference.call
