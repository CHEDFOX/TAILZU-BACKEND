# X0 Bot server

The server behind X0 Bot (formerly Tulmi, then Tailzu): the phone app, the desktop app and the website all talk
to it. It writes what a person says or types in their own voice, in most languages with Hindi and Hinglish
first; it builds every screen the apps draw (server-driven UI); it runs the Bots app's bots; and it runs Xode,
the coding bot that works on a person's GitHub repos.

The apps are thin: they capture input, send it, and draw what comes back.

## Layout

```
tulmi/          the server: Node 20+, TypeScript, Fastify (deploys to the VPS with Docker)
jobs/           Cloudflare Worker: Xode's jobs, the cron ticker, the live session
viewer/         Cloudflare Worker: the sandboxed artifact viewer
media-worker/   Python service for office files, hard PDFs, pictures and video
shared/         the wire contracts (types/api.ts, types/sdui.ts) and the bots' looks and sounds
deploy/         the deploy script, Caddy, release receiver, app-link files
docs/           one document per subsystem
```

[`archi.md`](archi.md) maps every folder, says where to find each feature, and how the parts connect.

## Quick start

```bash
cd tulmi
cp ../.env.example .env      # DEV_SKIP_AUTH=true runs without Supabase; add the model keys you have
npm install
npm run dev                  # the server, in watch mode

npx tsc --noEmit -p .        # typecheck
npx vitest run               # the test suite
```

More in [`tulmi/README.md`](tulmi/README.md) (the API at a glance, settings) and the wire contract in
[`shared/types/api.ts`](shared/types/api.ts) and [`shared/types/sdui.ts`](shared/types/sdui.ts).

## Deploy

On the VPS the repo lives at `~/tulmi`:

```bash
ssh root@<server> "cd ~/tulmi && git pull && ./deploy/ship.sh"
```

[`DEPLOY.md`](DEPLOY.md) covers the first setup and every optional service.
