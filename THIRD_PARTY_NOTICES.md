# Third-party notices

Tailzu's Code bot uses the open-source work below. Everything here is under the MIT licence; the licence text, with each copyright holder's line, follows the table. Dependencies are pinned to exact versions (`tulmi/package.json`, `jobs/package.json`). Nothing from an AGPL, GPL or other copyleft project is used.

## What is used, and where

| Component | Version | Licence | Copyright | Used for |
|---|---|---|---|---|
| [web-tree-sitter](https://github.com/tree-sitter/tree-sitter) (WebAssembly build of tree-sitter) | 0.27.1 | MIT | (c) 2018 Max Brunsfeld | The parser engine of the project brain (`tulmi/src/code/project/treesitter`), on the VPS and in the jobs Worker |
| [tree-sitter-wasm](https://github.com/Crysthamus/tree-sitter-wasm) (prebuilt grammar binaries) | 2.0.4 | MIT | (c) 2026 Crysthamus | The `.wasm` grammars listed below, loaded from `node_modules` on the VPS and bundled as modules into the Worker (`jobs/src/grammars.ts`) |
| tree-sitter-typescript (TypeScript, TSX) | via tree-sitter-wasm | MIT | (c) 2017 Max Brunsfeld | Grammar |
| tree-sitter-javascript (JavaScript, JSX) | via tree-sitter-wasm | MIT | (c) 2014 Max Brunsfeld | Grammar |
| tree-sitter-python | via tree-sitter-wasm | MIT | (c) 2016 Max Brunsfeld | Grammar |
| tree-sitter-go | via tree-sitter-wasm | MIT | (c) 2014 Max Brunsfeld | Grammar |
| tree-sitter-rust | via tree-sitter-wasm | MIT | (c) 2017 Maxim Sokolov | Grammar |
| tree-sitter-java | via tree-sitter-wasm | MIT | (c) 2017 Ayman Nadeem | Grammar |
| tree-sitter-kotlin | via tree-sitter-wasm | MIT | (c) 2019 fwcd | Grammar |
| tree-sitter-ruby | via tree-sitter-wasm | MIT | (c) 2016 Rob Rix | Grammar |
| tree-sitter-php | via tree-sitter-wasm | MIT | (c) 2017 Josh Vera, GitHub; (c) 2019 Max Brunsfeld, Amaan Qureshi, Christian Frøystad, Caleb White | Grammar |
| tree-sitter-swift | via tree-sitter-wasm | MIT | (c) 2021 alex-pinkus | Grammar |
| tree-sitter-c-sharp | via tree-sitter-wasm | MIT | (c) 2014-2023 Max Brunsfeld, Damien Guard, Amaan Qureshi, and contributors | Grammar |
| tree-sitter-dart | via tree-sitter-wasm | MIT | (c) 2020-2023 UserNobody14 and others | Grammar |
| tree-sitter-html | via tree-sitter-wasm | MIT | (c) 2014 Max Brunsfeld | Grammar |
| [Gitleaks](https://github.com/gitleaks/gitleaks) default rules (`config/gitleaks.toml`) | config format `minVersion = "v8.25.0"` (fetched 27 Oct 2026, release v8.30.1 era) | MIT | (c) 2019 Zachary Rice | The secret scan's provider rules. Vendored unchanged at `tulmi/third_party/gitleaks/gitleaks.toml` with its `LICENSE`; translated by `tulmi/scripts/gen-gitleaks.ts` into `tulmi/src/code/secrets/gitleaksRules.ts` |

`tree-sitter-wasm` does not publish which commit of each upstream grammar it built; the licence of each upstream repository (the ones named above) was read on 27 Oct 2026 and is MIT. The grammars' copyright lines are as their repositories state them.

### What was changed in Gitleaks' rules

The rules are Go (RE2) regular expressions. `gen-gitleaks.ts` rewrites them as JavaScript regular expressions that match the same text (scoped `(?i)` flags written out as character classes, `\z`, named groups, POSIX classes), drops the leading lazy `[\w.-]{0,50}?` of about half of the rules (the scan puts it back where an allowlist reads the whole match), reads two `curl` rules inside a bounded window of text, names each rule in plain words, and writes example tokens in the allowlists with `\u` escapes so that a scanner does not flag the generated file. The semantics Gitleaks documents are kept: keyword prefilter, `secretGroup`, entropy floor, rule and global allowlists (paths, regexes on the secret, match or line, stopwords, `AND`/`OR`), and a rule with only a `path`. The scan reports a kind of secret ("a GitLab token"), never the text that matched.

## Ideas credited (no code copied)

- **Aider's repo map** ([Aider-AI/aider](https://github.com/Aider-AI/aider), Apache-2.0): the idea of ranking files by a PageRank over a definition/reference graph, personalised on the identifiers and paths a request mentions, and the edge weighting by name shape. `tulmi/src/code/project/repomap.ts` is written from that published description, with edges also run backwards, and shares no code with Aider.
- **Observation masking** (SWE-agent, MIT; OpenHands, MIT; JetBrains Research, "The Complexity Trap", arXiv 2508.21433): replacing old tool outputs, not the model's actions, with a placeholder. `tulmi/src/code/agent/mask.ts` is written for Tailzu's own tools.

## Licence text

```
MIT License

Copyright (c) the copyright holders named above

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Gitleaks (verbatim)

```
MIT License

Copyright (c) 2019 Zachary Rice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
