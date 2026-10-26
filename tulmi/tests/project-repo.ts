/**
 * "ACME SHOP": THE SMALL MULTI-LANGUAGE REPO THE PROJECT BRAIN'S TESTS BUILD.
 *
 * A pnpm Next.js + Express web app (TypeScript, with a tsconfig `@/` alias and
 * a translation file), a FastAPI service (Python, with relative imports), a Go
 * service (its own go.mod), a Flutter app (Dart, Android strings, iOS strings),
 * a CI workflow and a Dockerfile; and the things that must NOT be read: a .env,
 * a private key, node_modules, a minified bundle, a binary and a file over 512 KB.
 * Its agent docs are CLAUDE.md and AGENTS.md.
 */

export const SECRET_ENV = "STRIPE_SECRET=sk_live_4eC39HqLyjWDarjtT1zdp7dc\nDATABASE_URL=postgres://admin:hunter2@db.internal/acme\n";
export const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n";

export function acmeFiles(): Record<string, string | Buffer> {
  return {
    "README.md": "# Acme Shop\n\nA small shop with a web app, an API, a Go worker and a Flutter app.\n",
    "CLAUDE.md": "# Rules for Claude\n\nAlways run `pnpm test` before you commit.\nUse 2 spaces and single quotes.\n",
    "AGENTS.md": "# Agents\n\nNever edit files under `src/generated`.\n",
    "package.json": JSON.stringify({
      name: "acme-shop", private: true, packageManager: "pnpm@9.1.0", main: "src/server/index.ts",
      scripts: { dev: "next dev", build: "next build", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit", start: "node dist/server.js" },
      dependencies: { next: "^14.2.0", react: "^18.2.0", "react-dom": "^18.2.0", express: "^4.18.0", zod: "^3.23.0", "old-lib": "^1.0.0" },
      devDependencies: { vitest: "^1.6.0", typescript: "^5.4.0", eslint: "^8.57.0", prettier: "^3.2.0" },
    }, null, 2),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "tsconfig.json": "{\n  // paths\n  \"compilerOptions\": {\n    \"baseUrl\": \".\",\n    \"paths\": { \"@/*\": [\"src/*\"] },\n  },\n}\n",
    ".prettierrc": JSON.stringify({ semi: true, singleQuote: true }),
    ".env.example": "# the keys\nSTRIPE_KEY=sk_live_abc123\nDATABASE_URL=postgres://localhost/acme\nNEXT_PUBLIC_API=https://api.acme.test\n",
    ".env": SECRET_ENV,
    "certs/server.pem": PRIVATE_KEY,
    "Dockerfile": "FROM node:20-alpine\nEXPOSE 3000\nCMD [\"node\", \"dist/server.js\"]\n",
    ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n",
    "locales/en.json": JSON.stringify({ auth: { signup: { button: "Sign up", title: "Create your account" } }, nav: { home: "Home" } }, null, 2),

    // The web app
    "src/app/page.tsx": "export default function HomePage() {\n  return (\n    <main>\n      <h1>Welcome to Acme</h1>\n      <button type=\"submit\">Sign up</button>\n    </main>\n  );\n}\n",
    "src/app/layout.tsx": "import type { ReactNode } from 'react';\n\nexport default function Layout({ children }: { children: ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n",
    "src/app/settings/page.tsx": "import { SettingsForm } from '@/components/SettingsForm';\n\nexport default function SettingsPage() {\n  return <SettingsForm />;\n}\n",
    "src/app/api/users/route.ts": "import { fetchUsers } from '@/lib/api';\n\nexport async function GET() {\n  return Response.json(await fetchUsers());\n}\n\nexport async function POST(req: Request) {\n  return Response.json({ ok: true });\n}\n",
    "src/components/SignupForm.tsx": "import { useState } from 'react';\nimport { fetchUsers } from '@/lib/api';\nimport { slug } from '../lib/util';\n\n// TODO: validate the email\nexport function SignupForm() {\n  const [email, setEmail] = useState('');\n  const base = process.env.NEXT_PUBLIC_API;\n  return (\n    <form>\n      <input placeholder=\"Email address\" value={email} onChange={(e) => setEmail(e.target.value)} />\n      <button>Create account</button>\n    </form>\n  );\n}\n",
    "src/components/SettingsForm.tsx": "import { slug } from '../lib/util';\n\n// FIXME: save the settings\n// TODO: add a dark mode switch\n// HACK: reload the page after saving\nexport function SettingsForm() {\n  return (\n    <section>\n      <h2>Account settings</h2>\n      <label title=\"Your display name\">Name</label>\n    </section>\n  );\n}\n",
    "src/lib/api.ts": "import { slug } from './util';\n\nexport interface User { id: string; name: string }\n\nexport async function fetchUsers(): Promise<User[]> {\n  const base = process.env.STRIPE_KEY;\n  return [];\n}\n\nexport const API_VERSION = 'v1';\n",
    "src/lib/util.ts": "export function slug(s: string): string {\n  return s.toLowerCase().replace(/\\s+/g, '-');\n}\n",
    "src/lib/api.test.ts": "import { fetchUsers } from './api';\n\ntest('users', async () => {\n  expect(await fetchUsers()).toEqual([]);\n});\n",
    "src/server/index.ts": "import express from 'express';\nimport { fetchUsers } from '../lib/api';\n\nconst app = express();\nconst router = express.Router();\n\napp.get('/health', (req, res) => res.send('ok'));\nrouter.post('/orders', async (req, res) => { res.json(await fetchUsers()); });\n\nexport default app;\n",
    "src/lib/weird.js": "var a = 1;\n\u0000\u0000\u0000binary after this",
    "src/generated/huge.ts": "export const data = '" + "x".repeat(600 * 1024) + "';\n",
    "src/lib/vendor.min.js": "!function(){var a=1}();",
    "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]),
    "node_modules/lodash/index.js": "module.exports = {};\n",
    "dist/bundle.js": "console.log('built');\n",

    // The API (Python)
    "api/__init__.py": "",
    "api/main.py": "import os\nfrom fastapi import FastAPI\nfrom .models import Item\nfrom .utils.helpers import fmt\n\napp = FastAPI()\nTOKEN = os.environ[\"API_TOKEN\"]\n\n\n@app.get(\"/items/{item_id}\")\nasync def read_item(item_id: int):\n    return Item(id=item_id)\n\n\ndef helper():\n    # TODO: remove\n    return fmt(1)\n",
    "api/models.py": "class Item:\n    def __init__(self, id):\n        self.id = id\n",
    "api/utils/__init__.py": "",
    "api/utils/helpers.py": "from ..models import Item\n\n\ndef fmt(n):\n    return str(n)\n",
    "api/tests/test_main.py": "from api.main import app\n\n\ndef test_app():\n    assert app\n",
    "requirements.txt": "fastapi==0.110.0\npytest\nrequests>=2.0\n",

    // The Go service
    "svc/go.mod": "module example.com/acme/svc\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n",
    "svc/main.go": "package main\n\nimport (\n\t\"net/http\"\n\n\t\"example.com/acme/svc/internal/store\"\n)\n\nfunc main() {\n\thttp.HandleFunc(\"/ping\", func(w http.ResponseWriter, r *http.Request) { store.Get() })\n}\n",
    "svc/internal/store/store.go": "package store\n\nfunc Get() string { return \"x\" }\n",
    "svc/internal/store/store_test.go": "package store\n\nimport \"testing\"\n\nfunc TestGet(t *testing.T) { Get() }\n",

    // The Flutter app
    "app/pubspec.yaml": "name: acme_app\ndescription: Acme\ndependencies:\n  flutter:\n    sdk: flutter\n  provider: ^6.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n",
    "app/lib/main.dart": "import 'package:acme_app/screens/home.dart';\n\nvoid main() {\n  runApp(const HomeScreen());\n}\n",
    "app/lib/screens/home.dart": "import 'package:flutter/material.dart';\n\nclass HomeScreen extends StatelessWidget {\n  const HomeScreen({super.key});\n  @override\n  Widget build(BuildContext context) => Column(children: [Text('Welcome home'), TextField(decoration: InputDecoration(hintText: 'Search the shop'))]);\n}\n",
    "app/test/home_test.dart": "import 'package:acme_app/screens/home.dart';\n\nvoid main() {}\n",
    "app/android/app/src/main/res/values/strings.xml": "<resources>\n  <string name=\"app_name\">Acme</string>\n  <string name=\"checkout\">Check out now</string>\n</resources>\n",
    "app/ios/Runner/en.lproj/Localizable.strings": "\"cart.empty\" = \"Your cart is empty\";\n",
  };
}
