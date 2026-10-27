/**
 * WHAT A JOB'S COPY OF THE CODE HOLDS: THE PROJECT BRAIN'S SKIP RULES, APPLIED TO A TARBALL AS IT STREAMS.
 *
 * The snapshot (project/snapshot.ts selectFiles) chooses what to read from the TREE, before anything is downloaded. A room gets the
 * tarball and so sees each entry's path and size in its header, which is the same information, and `skipReason` is the same decision
 * from it, with the same predicates (project/lang.ts):
 *
 *   secret      an env file, a key, a certificate, a credentials file: NEVER held, not even its name. (The brain records that one exists;
 *               a room has no use for the fact, and a listing that names `.env` tells a model there is something to go looking for)
 *   vendored    node_modules, vendor, dist, build, .next, target, coverage ...
 *   lockfile    package-lock.json, yarn.lock ...
 *   generated   *.min.js, *.map, *.pb.go ...
 *   binary      by extension (images, fonts, archives ...), or a NUL in the first 8 KB
 *   too_big     over 512 KB, or empty
 *
 * What is skipped (except secrets) is still LISTED, by name and reason, so `list` and `glob` show the folder as it is and a read of a
 * skipped file can be answered from GitHub instead. Unlike the brain's analysis, a room does not limit itself to files in a language
 * it knows: a person greps for a string in a .sql, a .txt or a .json fixture too.
 *
 * `.env.example` is documentation and is held, but only the NAMES of its variables (namesOnly), as the snapshot does.
 */
import { isBinaryPath, isEnvExample, isGeneratedPath, isLockfile, isSecretPath, isVendoredPath } from "../project/lang.js";
import { namesOnly } from "../project/snapshot.js";
import { BINARY_SNIFF_BYTES } from "../project/types.js";
import { FILE_MAX_BYTES } from "./limits.js";

export type SkipReason = "vendored" | "lockfile" | "generated" | "binary" | "too_big" | "empty";

/** The decision about a tarball entry from its header alone: null to hold it, a reason to skip it, or "secret" to forget it entirely. */
export function skipReason(path: string, size: number): SkipReason | "secret" | null {
  if (isSecretPath(path)) return "secret";
  if (isVendoredPath(path)) return "vendored";
  if (isLockfile(path)) return "lockfile";
  if (isGeneratedPath(path)) return "generated";
  if (isBinaryPath(path)) return "binary";
  if (size > FILE_MAX_BYTES) return "too_big";
  if (size <= 0) return "empty";
  return null;
}

/**
 * A held file's bytes as text, or null when they are binary (a NUL in the first 8 KB). A byte-order mark is dropped; line endings are
 * kept exactly as the file has them, so what the model reads is what an edit must match (the brain's `decodeText` makes CRLF into LF,
 * which is right for analysis and wrong for a copy that read_file answers from).
 */
export function textOf(path: string, bytes: Uint8Array): string | null {
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return isEnvExample(path) ? namesOnly(text) : text;
}
