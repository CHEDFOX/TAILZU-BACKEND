; Ruby: classes, modules, methods (def and def self.), constants; calls.
(class name: (constant) @name) @definition.class
(class name: (scope_resolution name: (constant) @name)) @definition.class
(module name: (constant) @name) @definition.module
(module name: (scope_resolution name: (constant) @name)) @definition.module
(method name: (_) @name) @definition.method
(singleton_method name: (_) @name) @definition.method
(assignment left: (constant) @name) @definition.const

(call method: (identifier) @name) @reference.call
(class superclass: (superclass (constant) @name)) @reference.implementation
(scope_resolution name: (constant) @name) @reference.class
