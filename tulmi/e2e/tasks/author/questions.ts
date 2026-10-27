/**
 * CODE QUESTIONS WITH KNOWN ANSWERS: "WHERE IS X HANDLED", "EXPLAIN THE FLOW OF Y".
 *
 * Each has the files an answer should point at and the facts it must state. The facts are regular expressions that are checked, when the task is validated,
 * against the text of those files at the pinned commit: the ground truth is in the code, not in the author's memory. A good answer changes nothing.
 */
import type { Task } from "../schema.js";
import { task } from "./lib.js";

const q = (o: {
  id: string; title: string; repo: string; request: string; files: string[]; facts: string[]; answer: string; rubric: string[]; difficulty?: 1 | 2 | 3 | 4 | 5; tags?: string[];
}): Task => task({
  id: o.id, title: o.title, category: "question", repo: o.repo, request: o.request, difficulty: o.difficulty ?? 3,
  tags: ["question", ...(o.tags ?? []), o.repo],
  front: { intent: "code_question" },
  truth: { files: [], answerFiles: o.files, facts: o.facts },
  oracle: { kind: "answer", answer: o.answer, classify: { type: "question" } },
  rubric: o.rubric,
  checks: { suite: false, expectNoChange: true, questions: { max: 0 }, expectPr: false },
});

export async function tasks(): Promise<Task[]> {
  return [
    q({
      id: "express-question-etag", title: "How an ETag gets on a response", repo: "express", difficulty: 3, tags: ["bakeoff"],
      request: "How does Express decide to put an ETag header on what res.send sends, and what can the 'etag' setting be set to? Point me at the code.",
      files: ["lib/response.js", "lib/utils.js", "lib/application.js"],
      facts: ["etag fn", "compileETag", "weak", "strong"],
      answer:
        "Setting 'etag' goes through app.set in lib/application.js, which compiles the value with compileETag (lib/utils.js) into the 'etag fn' setting. "
        + "compileETag accepts a function (used as it is), true or 'weak' (a weak ETag, the default set in lib/application.js), 'strong' (a strong one) and false (no ETag), and throws a TypeError for anything else. "
        + "In res.send (lib/response.js) the response gets an ETag only if no ETag header was set already and 'etag fn' is a function; the ETag is computed from the body chunk after its length is known.",
      rubric: ["Names app.set / the 'etag fn' setting as where the option is compiled", "Lists the accepted values: function, true/weak, strong, false", "Says res.send only generates an ETag when none is set and the function exists", "Points at lib/response.js, lib/utils.js and lib/application.js"],
    }),
    q({
      id: "flask-question-dispatch", title: "A request through a Flask app", repo: "flask", difficulty: 4, tags: ["bakeoff", "quick"],
      request: "Walk me through what Flask does, in order, from the moment the WSGI server calls the app until a response is returned, including what happens when a view raises an error.",
      files: ["src/flask/app.py"],
      facts: ["wsgi_app", "request_context", "full_dispatch_request", "preprocess_request", "dispatch_request", "finalize_request", "make_response", "process_response", "handle_exception"],
      answer:
        "Flask.__call__ in src/flask/app.py hands the WSGI call to wsgi_app. wsgi_app builds a context with request_context(environ), pushes it, and calls full_dispatch_request. "
        + "full_dispatch_request runs preprocess_request (before-request functions and URL value preprocessors; if one returns a value it becomes the response), otherwise dispatch_request, which calls the view for the matched endpoint. "
        + "The return value goes through finalize_request, which turns it into a response with make_response and passes it through process_response (after-request functions, saving the session). "
        + "If the view raises, handle_user_exception looks for a registered error handler; an unhandled error reaches handle_exception in wsgi_app, which logs it and returns a 500. "
        + "Finally the response is called with environ and start_response, and the context is popped so teardown functions run, even after an error.",
      rubric: ["Starts at __call__/wsgi_app and the request context being pushed", "Orders preprocess_request before dispatch_request, then finalize_request/make_response/process_response", "Explains error handling: handle_user_exception for handled errors and handle_exception for 500s", "Mentions the context being popped and teardown functions running"],
    }),
    q({
      id: "commander-question-parse-order", title: "Commander's order of work when parsing", repo: "commander", difficulty: 4, tags: ["bakeoff"],
      request: "When I call program.parse(), in what order does commander handle options from the command line, options from environment variables, implied options, subcommands and the action handler? Tell me which methods do each.",
      files: ["lib/command.js"],
      facts: ["parseOptions", "_parseOptionsEnv", "_parseOptionsImplied", "_dispatchSubcommand", "preAction"],
      answer:
        "In lib/command.js, _parseCommand first calls parseOptions on the arguments from the command line, then _parseOptionsEnv (after the command line, so an option is not parsed twice), then _parseOptionsImplied. "
        + "Then, if the first operand names a subcommand, it goes to _dispatchSubcommand; the help command and the default command are handled next. "
        + "Otherwise it prints help if requested, checks for missing mandatory options and for conflicting options, and, when there is an action handler, checks for unknown options, processes the arguments, runs the preAction hooks, the action handler, and the postAction hooks.",
      rubric: ["Parses command-line options (parseOptions) before environment variables (_parseOptionsEnv)", "Says implied options (_parseOptionsImplied) come after env", "Says a subcommand is dispatched with _dispatchSubcommand before the action of this command runs", "Mentions the preAction/postAction hooks around the action handler"],
    }),
    q({
      id: "changesets-question-release-plan", title: "How changesets assemble a release plan", repo: "changesets", difficulty: 5, tags: ["bakeoff", "quick"],
      request: "Where does changesets turn a pile of changeset files into a release plan, and which steps handle dependents, fixed packages and linked packages? I want the functions and the files.",
      files: ["packages/assemble-release-plan/src/index.ts", "packages/assemble-release-plan/src/determine-dependents.ts", "packages/assemble-release-plan/src/match-fixed-constraint.ts", "packages/assemble-release-plan/src/apply-links.ts", "packages/assemble-release-plan/src/flatten-releases.ts"],
      facts: ["assembleReleasePlan", "flattenReleases", "determineDependents", "matchFixedConstraint", "applyLinks"],
      answer:
        "It is the assembleReleasePlan function in packages/assemble-release-plan/src/index.ts. It collects the relevant changesets, turns them into one release per package with flattenReleases (packages/assemble-release-plan/src/flatten-releases.ts), "
        + "and then loops until nothing changes: determineDependents (packages/assemble-release-plan/src/determine-dependents.ts) adds packages whose dependencies were released, matchFixedConstraint (packages/assemble-release-plan/src/match-fixed-constraint.ts) brings every package of a fixed group to the highest bump, "
        + "and applyLinks (packages/assemble-release-plan/src/apply-links.ts) makes linked packages share the highest version. It then works out the new versions and returns the plan.",
      rubric: ["Names assembleReleasePlan in packages/assemble-release-plan/src/index.ts as the entry", "Says changesets are flattened into releases with flattenReleases", "Says dependents are added by determineDependents, fixed groups by matchFixedConstraint and linked groups by applyLinks", "Explains it repeats until nothing changes"],
    }),
    q({
      id: "zustand-question-persist", title: "How zustand's persist migrates stored state", repo: "zustand", difficulty: 3, tags: ["bakeoff"],
      request: "In zustand's persist middleware, how does a stored state get loaded back and what happens when the stored version is not the current one? What if there is no migrate function?",
      files: ["src/middleware/persist.ts"],
      facts: ["hydrate", "version", "migrate", "partialize", "skipHydration", "couldn't be migrated"],
      answer:
        "In src/middleware/persist.ts the hydrate function reads the stored value from the storage and compares its version with options.version. If they differ and a migrate function was given, migrate(state, storedVersion) produces the new state; "
        + "if there is no migrate function it logs the error \"State loaded from storage couldn't be migrated since no migrate function was provided\" and the stored state is not used. "
        + "The state that is written is chosen with partialize. Hydration runs when the store is created unless skipHydration is set, in which case the app calls rehydrate itself; hasHydrated tells whether it has finished.",
      rubric: ["Says hydrate reads from storage and compares the stored version with options.version", "Says migrate is called on a mismatch, and what happens without one (error logged, stored state not used)", "Mentions partialize for what is saved and skipHydration for delaying hydration"],
    }),
    q({
      id: "vite-question-auth-redirect", title: "Where an unauthenticated visitor is sent", repo: "bulletproof-vite", difficulty: 3, tags: ["bakeoff"],
      request: "In this app, how does it decide that a visitor has to log in, and where do they end up after being turned away? Which files are involved?",
      files: ["src/lib/auth.tsx", "src/app/router.tsx", "src/config/paths.ts"],
      facts: ["ProtectedRoute", "useUser", "Navigate", "redirectTo", "paths\\.auth\\.login"],
      answer:
        "The ProtectedRoute component in src/lib/auth.tsx calls useUser and, when there is no user data, renders a Navigate to paths.auth.login.getHref(location.pathname) with replace. "
        + "src/config/paths.ts builds that address as /auth/login with a redirectTo query parameter holding the page they wanted. "
        + "src/app/router.tsx wraps the whole app root route in ProtectedRoute, so every route under it needs a logged-in user.",
      rubric: ["Names ProtectedRoute and useUser in src/lib/auth.tsx", "Says the redirect goes to the login path with a redirectTo parameter (paths.auth.login)", "Says router.tsx wraps the app routes in ProtectedRoute"],
    }),
    q({
      id: "click-question-completion", title: "Shell completion in click", repo: "click", difficulty: 3, tags: ["bakeoff"],
      request: "Where is shell completion implemented in click, how are bash, zsh and fish each supported, and how would someone add a new shell?",
      files: ["src/click/shell_completion.py"],
      facts: ["ShellComplete", "BashComplete", "ZshComplete", "FishComplete", "add_completion_class", "get_completion_class"],
      answer:
        "It is all in src/click/shell_completion.py. ShellComplete is the base class; BashComplete, ZshComplete and FishComplete (and a PowerShell one) subclass it with the shell's own script template and the way a request is read from the environment. "
        + "get_completion_class(shell) looks up the class for a shell name, and add_completion_class registers a new one, so supporting another shell means writing a ShellComplete subclass and registering it with add_completion_class. "
        + "_resolve_context and _resolve_incomplete then work out which command and which parameter is being completed.",
      rubric: ["Names src/click/shell_completion.py and the base class ShellComplete", "Names the per-shell subclasses BashComplete, ZshComplete and FishComplete", "Says a new shell is added by subclassing and registering with add_completion_class"],
    }),
    q({
      id: "body-parser-question-charset", title: "An unsupported charset in body-parser", repo: "body-parser", difficulty: 3, tags: ["bakeoff"],
      request: "What happens when a client sends a JSON request with a charset body-parser does not support? Which status and error type does the app see, and where in the code is that decided?",
      files: ["lib/read.js", "lib/types/json.js"],
      facts: ["415", "charset\\.unsupported", "isValidCharset", "utf-", "getCharset"],
      answer:
        "The request is turned away with a 415 error whose type is 'charset.unsupported'. In lib/read.js the charset is taken from the Content-Type with getCharset, falling back to the default charset, and checked with the parser's isValidCharset; "
        + "lib/types/json.js supplies an isValidCharset that only accepts charsets starting with 'utf-' (RFC 7159 section 8.1). A charset that fails that check, or one iconv does not know, calls next with createError(415, 'unsupported charset ...', { charset, type: 'charset.unsupported' }).",
      rubric: ["States 415 and the error type charset.unsupported", "Says lib/read.js reads the charset (getCharset) and calls isValidCharset", "Says the json parser only accepts utf- charsets and cites the RFC or the check"],
    }),
  ];
}
