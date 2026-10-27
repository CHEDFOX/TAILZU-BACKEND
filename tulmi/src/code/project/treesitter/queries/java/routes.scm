; Spring: @RequestMapping("/api") on the class, @GetMapping("/x") on methods. The code joins the class's prefix to each method's path.
(annotation
  name: (identifier) @verb
  arguments: (annotation_argument_list . [(string_literal (string_fragment) @path) (element_value_pair key: (identifier) @_k value: (string_literal (string_fragment) @path))]))
  @route
(marker_annotation name: (identifier) @verb) @route.bare
