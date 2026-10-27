; Dart: import 'package:x/y.dart'; import 'z.dart'; export 'w.dart'; part 'v.dart';
(import_or_export (library_import (import_specification (configurable_uri (uri (string_literal) @source))))) @import
(import_or_export (library_export (configurable_uri (uri (string_literal) @source)))) @import
(part_directive (uri (string_literal) @source)) @import
