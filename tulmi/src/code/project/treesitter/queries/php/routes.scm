; PHP / Laravel: Route::get('/x', ...).
(scoped_call_expression
  scope: (name) @scope
  name: (name) @verb
  arguments: (arguments . (argument (string (string_content) @path)))
  (#eq? @scope "Route")
  (#match? @verb "^(get|post|put|patch|delete|any|match|options)$")) @route
