; Java: types, methods and constructors; calls, instantiations and supertypes.
(class_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
(enum_declaration name: (identifier) @name) @definition.enum
(record_declaration name: (identifier) @name) @definition.class
(annotation_type_declaration name: (identifier) @name) @definition.interface
(method_declaration name: (identifier) @name) @definition.method

(method_invocation name: (identifier) @name) @reference.call
(object_creation_expression type: (type_identifier) @name) @reference.class
(superclass (type_identifier) @name) @reference.implementation
(super_interfaces (type_list (type_identifier) @name)) @reference.implementation
(type_identifier) @name @reference.type
(marker_annotation name: (identifier) @name) @reference.call
(annotation name: (identifier) @name) @reference.call
