/**
 * The project brain, reading a file without a model: symbols and routes (one
 * fixture per language and per route style), the environment variables and entry
 * marks, the TODO count, and the visible strings (JSX, HTML, translations,
 * Flutter, Android, iOS, Python and Go), with secrets kept out of them.
 */
import { describe, expect, it } from "vitest";
import { blankComments, countTodos, extractSymbols } from "../src/code/project/symbols.js";
import { cleanText, extractTexts } from "../src/code/project/texts.js";
import { languageOf } from "../src/code/project/lang.js";

const sym = (path: string, text: string, ctx = {}) =>
  extractSymbols(path, languageOf(path), text, ctx).map((s) => `${s.kind}:${s.name}@${s.line}${s.exported === false ? "(local)" : ""}${s.method ? ` ${s.method}` : ""}`);
const routes = (path: string, text: string, ctx = {}) => extractSymbols(path, languageOf(path), text, ctx).filter((s) => s.kind === "route").map((s) => `${s.method} ${s.path}`);

describe("blanking comments", () => {
  it("replaces comments with spaces, keeps line numbers, and leaves strings alone", () => {
    const out = blankComments('a // x\nb = "http://not-a-comment" /* y\nz */ c', { slash: true, hash: false, triple: false, backtick: false, apostrophe: "string" });
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain('"http://not-a-comment"');
    expect(out).not.toMatch(/x\n|\by\b|\bz\b/);
    expect(out.split("\n")[2]).toMatch(/c$/);
  });

  it("does not take a Rust lifetime for the start of a string", () => {
    const out = blankComments("fn f<'a>(x: &'a str) {} // note\nlet c = 'x';", { slash: true, hash: false, triple: false, backtick: false, apostrophe: "char" });
    expect(out).not.toContain("note");
    expect(out).toContain("fn f<'a>");
  });
});

describe("TypeScript and JavaScript", () => {
  it("finds what is exported, with its line, and what is not (top-level only)", () => {
    const code = `// export function commented() {}
import x from './x';
export function login(a: string) {}
export default function Home() { return <div/> }
export const Button = ({ label }) => <button>{label}</button>;
export const useThing = () => 1;
export const MAX = 5;
export interface User { id: string }
export type Id = string;
export enum Role { A }
export class Svc extends Base {}
function helper() {}
const Local = memo(() => <i/>);
export { helper, Local as Renamed };
export * from './y';
export { z } from './z';
if (x) {
  function nested() {}
}`;
    expect(sym("src/a.tsx", code)).toEqual([
      "function:login@3", "component:Home@4", "component:Button@5", "function:useThing@6", "const:MAX@7", "interface:User@8", "type:Id@9", "enum:Role@10",
      "class:Svc@11", "function:helper@12", "component:Local@13", "component:Renamed@14",
    ]);
  });

  it("calls a capitalised function in a .tsx file a component, and in a .ts file a function", () => {
    expect(sym("a.ts", "export function Card() {}")).toEqual(["function:Card@1"]);
    expect(sym("a.tsx", "export function Card() {}")).toEqual(["component:Card@1"]);
    expect(sym("a.tsx", "export const Card = React.forwardRef((p, r) => <div ref={r} />);")).toEqual(["component:Card@1"]);
    expect(sym("a.ts", "export default class extends Base {}")).toEqual(["class:default@1"]);
  });

  it("reads export lists that run over several lines, and leaves re-exports to the file they come from", () => {
    expect(sym("a.ts", "const a = () => 1;\nconst b = () => 2;\nexport {\n  a,\n  b as c,\n};\nexport {\n  d,\n} from './d';")).toEqual(["function:a@1", "function:b@2", "function:c@3"]);
  });

  it("reads CommonJS exports", () => {
    const got = sym("a.js", "function one() {}\nmodule.exports = { one, two: 2 };\nexports.three = function () {};\nmodule.exports.four = 4;");
    expect(got).toContain("function:one@1");
    expect(got).toContain("function:two@2");
    expect(got).toContain("function:three@3");
    expect(got).toContain("const:four@4");
  });

  it("finds express, fastify and hono routes, but not a client's calls", () => {
    const code = `const app = express();
app.get('/health', (req, res) => res.send('ok'));
router.post("/users/:id", auth, async (req, res) => {});
app.delete('/x', handler);
fastify.get('/f', { schema: {} }, async () => {});
fastify.route({ method: ['GET', 'POST'], url: '/multi', handler });
const h = new Hono();
h.put('/things', (c) => c.json({}));
app.route('/api');
axios.get('/api/users');
api.get('/api/users', { params: { a: 1 } });
http.post('/submit', body);
cache.get('key');`;
    expect(routes("src/server.ts", code)).toEqual(["GET /health", "POST /users/:id", "DELETE /x", "GET /f", "GET|POST /multi", "PUT /things", "ANY /api"]);
  });

  it("finds NestJS routes under their controller's prefix", () => {
    const code = "@Controller('users')\nexport class UsersController {\n  @Get()\n  all() {}\n  @Get(':id')\n  one() {}\n  @Post()\n  create() {}\n}";
    expect(routes("users.controller.ts", code)).toEqual(["GET /users", "GET /users/:id", "POST /users"]);
  });

  it("makes Next.js routes from where the file is: app/ and pages/, groups, params and API routes", () => {
    const ctx = { nextRoots: [""] };
    expect(routes("src/app/dashboard/[id]/page.tsx", "export default function P() {}", ctx)).toEqual(["GET /dashboard/:id"]);
    expect(routes("app/(marketing)/pricing/page.tsx", "export default function P() {}", ctx)).toEqual(["GET /pricing"]);
    expect(routes("app/docs/[...slug]/page.tsx", "export default function P() {}", ctx)).toEqual(["GET /docs/*slug"]);
    expect(routes("app/page.tsx", "export default function P() {}", ctx)).toEqual(["GET /"]);
    expect(routes("app/api/users/route.ts", "export async function GET() {}\nexport const POST = async () => {};", ctx)).toEqual(["GET /api/users", "POST /api/users"]);
    expect(routes("pages/blog/index.tsx", "export default function B() {}", ctx)).toEqual(["GET /blog"]);
    expect(routes("pages/about.tsx", "export default function B() {}", ctx)).toEqual(["GET /about"]);
    expect(routes("pages/api/hello.ts", "export default function h() {}", ctx)).toEqual(["ANY /api/hello"]);
    expect(routes("pages/_app.tsx", "export default function A() {}", ctx)).toEqual([]);
    expect(routes("apps/web/app/settings/page.tsx", "export default function S() {}", { nextRoots: ["apps/web"] })).toEqual(["GET /settings"]);
    // Without a Next.js app around it, a folder called app is just a folder.
    expect(routes("app/dashboard/page.tsx", "export default function P() {}", {})).toEqual([]);
  });

  it("records the environment variables a file reads, once each", () => {
    const got = extractSymbols("a.ts", "TypeScript", "const a = process.env.STRIPE_KEY + process.env['OTHER'] + process.env.STRIPE_KEY + import.meta.env.VITE_API;");
    expect(got.filter((s) => s.kind === "env").map((s) => s.name)).toEqual(["STRIPE_KEY", "OTHER", "VITE_API"]);
  });

  it("reads the script of a Vue single-file component with the right line numbers", () => {
    const got = extractSymbols("A.vue", "Vue", "<template>\n  <p>x</p>\n</template>\n<script>\nexport function helper() {}\n</script>");
    expect(got.map((s) => `${s.name}@${s.line}`)).toEqual(["helper@5"]);
  });
});

describe("Python", () => {
  const code = `import os
"""
def fake(): pass
"""
API_KEY = os.environ["API_KEY"]
class Foo:
    def bar(self): pass
    def _hidden(self): pass
@app.get("/items/{id}")
async def read_item(id): pass
@app.route("/login", methods=["GET", "POST"])
def login(): pass
def _private(): pass
if __name__ == "__main__":
    pass
`;
  it("finds functions, classes, methods as Class.method, constants, and what is private", () => {
    expect(sym("a.py", code)).toEqual([
      "const:API_KEY@5", "env:API_KEY@5", "class:Foo@6", "method:Foo.bar@7", "method:Foo._hidden@8(local)", "route:/items/{id}@9 GET", "function:read_item@10",
      "route:/login@11 GET|POST", "function:login@12", "function:_private@13(local)", "entry:__main__@14",
    ]);
  });

  it("reads FastAPI and Flask decorators as routes, and Django urlpatterns", () => {
    expect(routes("a.py", code)).toEqual(["GET /items/{id}", "GET|POST /login"]);
    expect(routes("urls.py", "urlpatterns = [\n  path('login/', views.login, name='login'),\n  re_path(r'^about/$', views.about),\n  path('api/', include('api.urls')),\n]")).toEqual(["ANY /login/", "ANY /about/", "ANY /api/"]);
    expect(routes("b.py", "@router.post('/orders')\nasync def make(): pass\n@bp.delete(\"/orders/<id>\")\ndef rm(): pass")).toEqual(["POST /orders", "DELETE /orders/<id>"]);
  });

  it("does not take a def inside a docstring or a comment for a function", () => {
    expect(sym("a.py", '"""\ndef nope(): pass\n"""\n# def also_nope(): pass\ndef yes(): pass')).toEqual(["function:yes@5"]);
  });
});

describe("Go", () => {
  const code = `package main
import "net/http"
type Server struct{}
type Handler interface{}
type ID string
const (
  A = 1
  B
)
var Default = 1
func (s *Server) Start() {}
func helper() {}
func main() {
  http.HandleFunc("/ping", ping)
  mux.HandleFunc("GET /users/{id}", get)
  r.GET("/g", h)
  os.Getenv("PORT")
}
`;
  it("finds funcs, methods, types, consts and vars, and which are exported", () => {
    expect(sym("main.go", code)).toEqual([
      "struct:Server@3", "interface:Handler@4", "type:ID@5", "const:A@7", "const:B@8", "const:Default@10", "method:Server.Start@11", "function:helper@12(local)",
      "function:main@13(local)", "entry:main@13", "env:PORT@17",
    ].filter((x) => !x.startsWith("route")).concat(["route:/ping@14 ANY", "route:/users/{id}@15 GET", "route:/g@16 GET"]).sort((a, b) => lineOf(a) - lineOf(b)));
  });

  it("reads HandleFunc, Go 1.22 method patterns and gin/echo/chi verbs as routes", () => {
    expect(routes("main.go", code)).toEqual(["ANY /ping", "GET /users/{id}", "GET /g"]);
  });
});

function lineOf(s: string): number { return Number(/@(\d+)/.exec(s)![1]); }

describe("Rust", () => {
  it("finds pub items, the main function, attribute routes, axum routes and env vars", () => {
    const code = "pub fn run() {}\npub struct Cfg;\npub(crate) enum E {}\npub trait T {}\npub const MAX: u32 = 1;\nfn main() {}\n#[get(\"/hi\")]\nasync fn hi() {}\nlet app = Router::new().route(\"/x\", get(h));\nlet h = std::env::var(\"HOME\");";
    expect(sym("lib.rs", code)).toEqual([
      "function:run@1", "struct:Cfg@2", "enum:E@3", "trait:T@4", "const:MAX@5", "function:main@6(local)", "entry:main@6", "route:/hi@7 GET", "function:hi@8(local)", "route:/x@9 GET", "env:HOME@10",
    ].sort((a, b) => lineOf(a) - lineOf(b)));
  });
});

describe("Java and Kotlin", () => {
  it("finds public classes and methods, Spring routes under the class's prefix, and main", () => {
    const code = '@RestController\n@RequestMapping("/api")\npublic class Users {\n  @GetMapping("/users")\n  public List<User> users() { return null; }\n  @PostMapping\n  public User create() { return null; }\n  public static void main(String[] args) {}\n  private int hidden() { return 1; }\n}';
    expect(sym("Users.java", code)).toEqual(["class:Users@3", "route:/api/users@4 GET", "method:users@5", "route:/api@6 POST", "method:create@7", "method:main@8", "entry:main@8"]);
  });

  it("finds Kotlin classes, functions and constants, and leaves private ones as local", () => {
    expect(sym("a.kt", "data class P(val a: Int)\nfun foo() {}\nprivate fun hid() {}\nconst val X = 1\nobject Cfg\ninterface Repo")).toEqual(["class:P@1", "function:foo@2", "function:hid@3(local)", "const:X@4", "class:Cfg@5", "interface:Repo@6"]);
  });
});

describe("Dart", () => {
  it("finds classes (a widget is a component), top-level functions, main and GoRoute paths", () => {
    const code = "class Home extends StatelessWidget {}\nclass _Private {}\nenum Mode { a }\nmixin Logger {}\nvoid main() {}\nFuture<void> go() async {}\nfinal r = GoRoute(path: '/settings', builder: (c, s) => S());\nconst version = '1';\nString.fromEnvironment('API_URL');";
    expect(sym("a.dart", code)).toEqual([
      "component:Home@1", "class:_Private@2(local)", "enum:Mode@3", "class:Logger@4", "function:main@5", "entry:main@5", "function:go@6", "const:r@7", "route:/settings@7 GET", "const:version@8", "env:API_URL@9",
    ].sort((a, b) => lineOf(a) - lineOf(b)));
  });
});

describe("Ruby, PHP, Swift and C#", () => {
  it("reads Rails routes and Ruby classes and methods", () => {
    const code = "Rails.application.routes.draw do\n  get '/about', to: 'p#a'\n  post 'login', to: 's#c'\n  resources :users\n  root 'home#index'\nend";
    expect(routes("config/routes.rb", code)).toEqual(["GET /about", "POST /login", "ANY /users", "GET /"]);
    expect(sym("user.rb", "class User < Base\n  def full_name; end\n  def self.find_it; end\nend")).toEqual(["class:User@1", "method:full_name@2", "method:self.find_it@3"]);
    expect(routes("app.rb", "get '/hello' do\n  'hi'\nend")).toEqual(["GET /hello"]);
  });

  it("reads PHP classes, methods and Laravel routes", () => {
    const code = "<?php\nclass Orders {\n  public function list() {}\n  private function hidden() {}\n}\nRoute::get('/orders', [Orders::class, 'list']);";
    expect(sym("Orders.php", code)).toEqual(["class:Orders@2", "method:list@3", "method:hidden@4(local)", "route:/orders@6 GET"]);
  });

  it("reads Swift types (a View is a component), functions and @main", () => {
    expect(sym("a.swift", "struct ContentView: View {}\npublic func hello() {}\n@main struct App {}")).toEqual(["component:ContentView@1", "function:hello@2", "entry:main@3", "struct:App@3"]);
  });

  it("reads C# classes, public methods, attribute routes and minimal API routes", () => {
    const code = 'public class Ctl {\n  [HttpGet("items")]\n  public IActionResult Items() { return Ok(); }\n}\napp.MapPost("/ping", () => 1);';
    expect(sym("Ctl.cs", code)).toEqual(["class:Ctl@1", "route:/items@2 GET", "method:Items@3", "route:/ping@5 POST"]);
  });

  it("falls back to simple patterns for the other languages", () => {
    expect(sym("a.c", "int main(int argc) {\n}\nstruct point { int x; };")).toEqual(["entry:main@1", "struct:point@3"]);
    expect(sym("a.sh", "deploy() {\n  echo hi\n}\nfunction build { :; }")).toEqual(["function:deploy@1", "function:build@4"]);
    expect(sym("a.sql", "create table if not exists users (id int);\ncreate or replace function f() returns int as $$ select 1 $$;")).toEqual(["struct:users@1", "function:f@2"]);
    expect(sym("a.json", '{"a": 1}')).toEqual([]);
  });

  it("keeps at most 120 symbols, routes and exports first", () => {
    const many = Array.from({ length: 200 }, (_, i) => `function f${i}() {}`).join("\n") + "\nexport function keep() {}\napp.get('/x', h);";
    const got = extractSymbols("a.js", "JavaScript", many);
    expect(got).toHaveLength(120);
    expect(got.some((s) => s.name === "keep")).toBe(true);
    expect(got.some((s) => s.kind === "route")).toBe(true);
  });
});

describe("TODO notes", () => {
  it("counts TODO, FIXME and HACK in comments, not in strings", () => {
    const code = `// TODO: one
const s = "TODO is a word";
/* FIXME two */
# HACK three
x = 1 // XXX four
 * TODO(alice): five`;
    expect(countTodos(code)).toBe(5);
    expect(countTodos("const todo = 1;")).toBe(0);
  });
});

// ------------------------------------------------------------ visible text

const texts = (path: string, text: string) => extractTexts(path, languageOf(path), text).map((t) => `${t.line}:${t.kind}:${t.text}`);

describe("the visible-text index", () => {
  it("reads JSX text between tags, on its own line, as a {literal}, and the title/placeholder/aria-label/alt attributes", () => {
    const code = `export function Login() {
  const x = a > b && c < d;
  return (
    <form>
      <h1>Welcome back</h1>
      <input placeholder="Email address" aria-label='Email' />
      <img alt="The logo" src={logo} />
      <button type="submit">Sign up</button>
      <p>
        Don't have an account?
      </p>
      <span>{"Forgot password"}</span>
      <a title="Help centre" href="/help">Help</a>
    </form>
  );
}`;
    expect(texts("src/Login.tsx", code)).toEqual([
      "5:jsx:Welcome back", "6:attr:Email address", "6:attr:Email", "7:attr:The logo", "8:jsx:Sign up", "10:jsx:Don't have an account?", "12:jsx:Forgot password", "13:attr:Help centre", "13:jsx:Help",
    ]);
  });

  it("does not read code as text: comparisons, generics, imports, class names", () => {
    const code = "const ok = a > b && c < d;\nconst m: Map<string, Array<number>> = new Map();\nimport x from 'y';\nreturn <div className=\"card\" data-x={y} />;";
    expect(texts("a.tsx", code)).toEqual([]);
  });

  it("reads HTML outside script and style, with attributes and text standing alone", () => {
    const html = `<html><head><title>Home page</title><script>var a = "x < y";</script><style>.a > .b { }</style></head>
<body>
<h1>Hello</h1>
<p>
  Welcome to the site
</p>
<a href="/x" title="Go home">Home</a>
<!-- <p>commented</p> -->
</body></html>`;
    expect(texts("page.html", html)).toEqual(["1:html:Home page", "3:html:Hello", "5:html:Welcome to the site", "7:attr:Go home", "7:html:Home"]);
  });

  it("reads the template of a Vue file and not its script", () => {
    expect(texts("A.vue", "<template>\n  <p>Press the button</p>\n</template>\n<script>\nexport default { name: 'x', title: 'Not shown' }\n</script>")).toEqual(["2:html:Press the button"]);
  });

  it("reads translation files with their keys, in JSON and YAML, and a Flutter .arb", () => {
    const json = JSON.stringify({ auth: { signup: { button: "Sign up", title: "Create your account" } }, nav: { home: "Home" }, n: 5 }, null, 2);
    expect(texts("locales/en.json", json)).toEqual(["4:i18n:auth.signup.button: Sign up", "5:i18n:auth.signup.title: Create your account", "9:i18n:nav.home: Home"]);
    expect(texts("src/i18n/hi.yaml", "auth:\n  signup:\n    button: \"साइन अप\"\nnav:\n  home: Home\n")).toEqual(["3:i18n:auth.signup.button: साइन अप", "5:i18n:nav.home: Home"]);
    expect(texts("l10n/app_en.arb", '{\n  "@@locale": "en",\n  "hello": "Hello {name}",\n  "@hello": { "description": "greeting" }\n}')).toEqual(["3:i18n:hello: Hello {name}"]);
    // Other JSON is data, not words.
    expect(texts("fixtures/data.json", '{"name": "Widget"}')).toEqual([]);
  });

  it("reads Flutter's Text, labelText, hintText and tooltip", () => {
    const dart = "Widget build(c) => Column(children: [Text('Hello world'), TextField(decoration: InputDecoration(labelText: \"Your name\", hintText: 'e.g. Asha')), const Text(\"Save\"), IconButton(tooltip: 'Delete it')]);\nText(name);\nText('$count items');";
    expect(texts("lib/ui.dart", dart)).toEqual(["1:flutter:Hello world", "1:flutter:Save", "1:flutter:Your name", "1:flutter:e.g. Asha", "1:flutter:Delete it", "3:flutter:items"]);
  });

  it("reads Android strings.xml (strings, arrays, plurals) and leaves out translatable=false", () => {
    const xml = '<resources>\n  <string name="app_name">My App</string>\n  <string name="api" translatable="false">xyz</string>\n  <string name="quote">Don\\\'t stop</string>\n  <string-array name="tabs"><item>Home</item><item>Away</item></string-array>\n</resources>';
    expect(texts("app/src/main/res/values/strings.xml", xml)).toEqual(["2:android:app_name: My App", "4:android:quote: Don't stop", "5:android:tabs: Home", "5:android:tabs: Away"]);
    expect(texts("app/src/main/res/layout/main.xml", '<Button android:text="Pay now" android:hint="@string/x" android:contentDescription="Pay button" />')).toEqual(["1:android:Pay now", "1:android:Pay button"]);
  });

  it("reads iOS .strings files and SwiftUI literals", () => {
    expect(texts("en.lproj/Localizable.strings", '/* a comment */\n"welcome" = "Welcome to the app";\n"bye" = "Goodbye";')).toEqual(["2:ios:welcome: Welcome to the app", "3:ios:bye: Goodbye"]);
    expect(texts("ContentView.swift", 'Text("Hello, world!")\nButton("Save") {}\nText(variable)')).toEqual(["1:ios:Hello, world!", "2:ios:Save"]);
  });

  it("reads the strings Python and Go pass to flash, messages, gettext, abort, render and templates", () => {
    expect(texts("views.py", 'from flask import flash\nflash("Profile updated")\nmessages.success(request, "Saved!")\nreturn render_template("login.html")\nabort(404, "No such page")\nx = _("Welcome back")\n# flash("commented out")')).toEqual([
      "2:string:Profile updated", "3:string:Saved!", "4:string:login.html", "5:string:No such page", "6:string:Welcome back",
    ]);
    expect(texts("main.go", 'func h(c *gin.Context){ c.HTML(200, "index.html", nil); c.String(200, "Hello there"); http.Error(w, "Not allowed", 403) }')).toEqual(["1:string:index.html", "1:string:Hello there", "1:string:Not allowed"]);
  });

  it("reads Ruby flash/notice and PHP __() strings", () => {
    expect(texts("c.rb", 'flash[:notice] = "Signed in"\nredirect_to root_path, alert: "Try again"')).toEqual(["1:string:Signed in", "2:string:Try again"]);
    expect(texts("v.php", "<?php\necho __('Add to cart');\nreturn view('cart.show');")).toEqual(["2:string:Add to cart", "3:string:cart.show"]);
  });

  it("drops a string on a line the secret scanner flags, and keeps the rest", () => {
    const code = `const t = <p>Hello there</p>;
const key = "AKIAIOSFODNN7EXAMPLE"; const label = <b>Your key is AKIAIOSFODNN7EXAMPLE</b>;
const u = <p>Another line</p>;`;
    const got = texts("a.tsx", code);
    expect(got).toEqual(["1:jsx:Hello there", "3:jsx:Another line"]);
    expect(got.join("")).not.toContain("AKIA");
    // An i18n value that is itself a key.
    expect(texts("locales/en.json", JSON.stringify({ a: "Fine", b: "ghp_" + "a".repeat(36) }, null, 2))).toEqual(["2:i18n:a: Fine"]);
  });

  it("cuts a long string to 160 characters, and drops one with no letters or that looks like a path or a constant", () => {
    expect(cleanText("x".repeat(300))!.length).toBe(160);
    for (const bad of ["123", "--", "a", "src/lib/api", "https://example.com/x", "SOME_CONSTANT", "foo(bar)", "a = b"]) expect(cleanText(bad), bad).toBeNull();
    expect(cleanText("  Sign   up\n now ")).toBe("Sign up now");
    expect(cleanText("Tom &amp; Jerry")).toBe("Tom & Jerry");
  });

  it("keeps at most 200 strings in a file", () => {
    const many = Array.from({ length: 300 }, (_, i) => `<p>Line number ${String.fromCharCode(97 + (i % 26))}${i}</p>`).join("\n");
    expect(extractTexts("a.html", "HTML", many)).toHaveLength(200);
  });
});
