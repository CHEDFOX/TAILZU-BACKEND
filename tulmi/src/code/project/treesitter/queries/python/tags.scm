; Python: definitions (a def or class anywhere in a class or module body; the code drops what is local to a function) and references.
(function_definition name: (identifier) @name) @definition.function
(class_definition name: (identifier) @name) @definition.class
(module (expression_statement (assignment left: (identifier) @name)) @definition.variable)
(module (expression_statement (assignment left: (identifier) @name type: (_))) @definition.variable)

(call function: (identifier) @name) @reference.call
(call function: (attribute attribute: (identifier) @name)) @reference.call
(class_definition superclasses: (argument_list (identifier) @name)) @reference.implementation
(class_definition superclasses: (argument_list (attribute attribute: (identifier) @name))) @reference.implementation
(type (identifier) @name) @reference.type
(type (attribute attribute: (identifier) @name)) @reference.type
(decorator (identifier) @name) @reference.call
