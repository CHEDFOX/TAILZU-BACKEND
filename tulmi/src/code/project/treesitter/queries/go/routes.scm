; Go: http.HandleFunc("/x", h), mux.Handle("GET /x", h), gin/echo/chi r.GET("/x", h).
(call_expression
  function: (selector_expression field: (field_identifier) @verb)
  arguments: (argument_list . (interpreted_string_literal (interpreted_string_literal_content) @path))
  (#match? @verb "^(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any|ANY|Get|Post|Put|Patch|Delete|Head|Options)$")) @route
