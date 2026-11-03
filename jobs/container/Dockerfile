# X0's cloud runner: one container for one live session of one Xode job (jobs/src/containers.ts starts it, docs/cloudflare-jobs.md section 13).
# Node 22 with git and the tools a project's install usually needs (the official image, from its public mirror: no Docker Hub pull limits).
# The person's code runs here, never on the Worker or the VPS.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ curl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

WORKDIR /runner
# run.mjs is the same session runner GitHub's computers run (tulmi/src/code/jobs/runScript.ts RUN_MJS, written by tulmi/scripts/write-container-runner.ts).
COPY run.mjs entry.mjs ./
RUN mkdir -p /work && chown node:node /work

USER node
ENV NODE_ENV=development TAILZU_RUNNER_KIND=container
CMD ["node", "/runner/entry.mjs"]
