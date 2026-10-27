; HTTP routes in TypeScript and JavaScript servers (express, fastify, hono, koa-router, NestJS).
; A server passes a handler after the path; a client (axios.get('/x')) does not: the code checks that and the receiver's name.

; app.get('/x', handler)
(call_expression
  function: (member_expression object: (_) @receiver property: (property_identifier) @verb)
  arguments: (arguments . (string (string_fragment) @path) . (_) @handler)
  (#match? @verb "^(get|post|put|patch|delete|options|head|all)$")) @route

; app.route('/x')
(call_expression
  function: (member_expression object: (_) @receiver property: (property_identifier) @verb)
  arguments: (arguments . (string (string_fragment) @path))
  (#eq? @verb "route")) @route

; fastify.route({ method: 'GET', url: '/x' })
(call_expression
  function: (member_expression property: (property_identifier) @verb)
  arguments: (arguments . (object) @config)
  (#eq? @verb "route")) @route.config

; NestJS: @Controller('users') on the class, @Get(':id') on a method
(decorator
  (call_expression function: (identifier) @verb arguments: (arguments . (string (string_fragment) @path)?))
  (#match? @verb "^(Controller|Get|Post|Put|Patch|Delete|All|Head|Options)$")) @route.decorator
(decorator
  (call_expression function: (identifier) @verb arguments: (arguments))
  (#match? @verb "^(Get|Post|Put|Patch|Delete|All|Head|Options)$")) @route.decorator
