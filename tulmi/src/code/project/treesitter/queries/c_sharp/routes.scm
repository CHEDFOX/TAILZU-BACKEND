; ASP.NET: [HttpGet("{id}")] on an action, [Route("api/users")] on the controller, and minimal APIs: app.MapGet("/x", ...).
(attribute name: (identifier) @verb (attribute_argument_list . (attribute_argument (string_literal (string_literal_content) @path))))
  @route.attribute
(attribute name: (identifier) @verb !arguments) @route.attribute
(invocation_expression
  function: (member_access_expression name: (identifier) @verb)
  arguments: (argument_list . (argument (string_literal (string_literal_content) @path)))
  (#match? @verb "^Map(Get|Post|Put|Patch|Delete)$")) @route
