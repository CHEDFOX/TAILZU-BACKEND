; Swift / Vapor: app.get("users") { req in ... }. Routes in Swift servers are written as path segments, not one string, so only a lone literal is read.
(call_expression
  (navigation_expression suffix: (navigation_suffix suffix: (simple_identifier) @verb))
  (call_suffix (value_arguments . (value_argument (line_string_literal (line_str_text) @path) .)))
  (#match? @verb "^(get|post|put|patch|delete)$")) @route
