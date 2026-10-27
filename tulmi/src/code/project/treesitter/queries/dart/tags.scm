; Dart: a top-level function is a function_signature followed by its function_body; a method is a method_signature wrapping one.
(class_definition name: (identifier) @name) @definition.class
(mixin_declaration (identifier) @name) @definition.class
(enum_declaration name: (identifier) @name) @definition.enum
(extension_declaration name: (identifier) @name) @definition.class
(type_alias (type_identifier) @name) @definition.type
(function_signature name: (identifier) @name) @definition.function
(static_final_declaration (identifier) @name) @definition.const

(type_identifier) @name @reference.type
(superclass (type_identifier) @name) @reference.implementation
