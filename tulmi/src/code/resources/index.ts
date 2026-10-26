/**
 * RESOURCES AND RESEARCH, LAYER 6: FIND THE LIBRARY, AUDIT WHAT THE PROJECT ALREADY USES, WRITE THE BRIEF.
 * The story is in docs/code-work.md. It rides on layer 3 (web search and research: docs/web-search.md) and on
 * the project brain (layer 4) for the stack it weighs things against.
 *
 *   finder.ts     findResources(): a need -> a ranked shortlist of packages, with licence, maintenance,
 *                 security (OSV), size, popularity and stack fit, a score, one line each, and a pick
 *   licences.ts   SPDX normalising and the allowlist (MIT, Apache-2.0, BSD, ISC... ok; LGPL warns; GPL/AGPL warn strongly)
 *   osv.ts        OSV queries (query, querybatch, a record) and CVSS v3 scoring
 *   audit.ts      auditDeps(): the lockfiles (or the manifests, approximately) through OSV; the vulnerable packages and what fixes them
 *   lockfiles.ts  package-lock.json, pnpm-lock.yaml, yarn.lock, poetry.lock, Pipfile.lock, requirements.txt: name and version
 *   semver.ts     versions and ranges, just enough
 *   brief.ts      researchBrief(): research() with the project's stack, rendered, and committed to docs/research/
 *   net.ts        the one way layer 6 sends a POST (the egress guard, 10 s, a size cap)
 *
 * Nothing here is installed, and nothing is written to the repo but the brief, which goes through the policy
 * like any commit. Every network call takes an injectable `fetchFn`.
 */
export * from "./audit.js";
export * from "./brief.js";
export * from "./finder.js";
export * from "./licences.js";
export * from "./lockfiles.js";
export * from "./osv.js";
export * from "./semver.js";
