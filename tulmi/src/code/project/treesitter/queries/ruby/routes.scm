; Ruby: Rails routes.rb (get/post/resources/root) and Sinatra (get '/x' do).
(call method: (identifier) @verb arguments: (argument_list . (string (string_content) @path))
  (#match? @verb "^(get|post|put|patch|delete|match)$")) @route
(call method: (identifier) @verb arguments: (argument_list . (simple_symbol) @symbol)
  (#match? @verb "^(resources|resource)$")) @route.resources
(call method: (identifier) @verb !arguments (#eq? @verb "root")) @route.root
(call method: (identifier) @verb arguments: (argument_list (pair key: (hash_key_symbol) @_k))
  (#eq? @verb "root")) @route.root
