/**
 * READING A MANIFEST OR A LOCKFILE FROM THE WORK BRANCH, THROUGH THE WORKSPACE, EVEN WHEN IT IS BIG.
 *
 * auditDeps() (audit.ts) takes a function that reads a file's text: `fetchManifest(path)`. This is the one the
 * routes and the agent loop hand it. It reads through workspace().read, which is the same access check and the
 * same policy as every other read of the person's repo, but that read stops at 1 MB (code/github.ts), and a
 * lockfile of a real project is often two or three. So a file that is "too_large" is fetched as a git blob
 * instead (the same call the project brain makes), found in the branch's tree by its path, up to 20 MB.
 *
 * Anything that goes wrong is a null, never a throw: an audit with a lockfile it cannot read says so and falls back
 * to the manifests.
 */
import { ConnectorError } from "../../connectors/state.js";
import { repoRef, workspace, ownProject, type ProjectDeps } from "../projects.js";

export const BLOB_READ_MAX = 20 * 1024 * 1024;

export type ManifestReader = (path: string) => Promise<string | null>;

export async function manifestReader(d: ProjectDeps, userId: string, projectId: string, branch?: string): Promise<ManifestReader> {
  const project = await ownProject(d, userId, projectId);
  const ws = await workspace(d, userId, projectId, branch ?? project.defaultBranch);
  let shas: Map<string, string> | null = null;
  return async (path) => {
    try {
      return (await ws.read(path)).text;
    } catch (err) {
      if (!(err instanceof ConnectorError) || err.code !== "too_large") return null;
    }
    try {
      shas ??= new Map((await ws.tree()).entries.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
      const sha = shas.get(path);
      if (!sha) return null;
      const bytes = await d.github.blobBytes(repoRef(d, userId, project), sha);
      return bytes.length > BLOB_READ_MAX || bytes.includes(0) ? null : bytes.toString("utf8");
    } catch {
      return null;
    }
  };
}
