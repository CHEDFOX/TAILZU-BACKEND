; HTML: the words between tags and the attributes a person reads. <script> and <style> bodies are raw_text, not text.
(text) @text
(attribute (attribute_name) @attr.name (quoted_attribute_value (attribute_value) @attr.value) (#match? @attr.name "^(title|placeholder|aria-label|alt|label)$"))
