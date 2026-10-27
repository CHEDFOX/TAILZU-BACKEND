; FastAPI / Flask: @app.get("/x"), @router.route("/x", methods=["GET"]). Django: path("x/", view) in urlpatterns.
(decorated_definition
  (decorator
    (call
      function: (attribute attribute: (identifier) @verb)
      arguments: (argument_list . (string (string_content) @path) .) @args))
  (#match? @verb "^(get|post|put|patch|delete|head|options|route|websocket|api_route)$")) @route
(decorated_definition
  (decorator
    (call
      function: (attribute attribute: (identifier) @verb)
      arguments: (argument_list . (string (string_content) @path) (_)+) @args))
  (#match? @verb "^(get|post|put|patch|delete|head|options|route|websocket|api_route)$")) @route
(decorated_definition
  (decorator
    (call
      function: (attribute attribute: (identifier) @verb)
      arguments: (argument_list (keyword_argument name: (identifier) @_k value: (string (string_content) @path)) @args)))
  (#match? @verb "^(get|post|put|patch|delete|head|options|route|websocket|api_route)$")
  (#eq? @_k "path")) @route
(call
  function: (identifier) @django
  arguments: (argument_list . (string (string_content) @path) . (_) @view)
  (#match? @django "^(path|re_path|url)$")) @route.django
