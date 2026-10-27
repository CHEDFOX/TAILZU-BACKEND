# Tulmi backend

Node + TypeScript (Fastify). The "brain" behind every Tulmi surface — voice,
typing, and screen-reply — all shaped by the user's personality + context.

```
voice  ─▶ STT (OpenAI gpt-4o-transcribe / Groq) ─┐
typing ──────────────────────────────────────────┼─▶ OpenRouter LLM ─▶ personalized text
screen (content + intent) ───────────────────────┘    (+ personality, + app context)
                                                       └─▶ usage → Supabase
```

## Setup

```bash
cd tulmi
cp ../.env.example .env     # fill in GROQ_API_KEY + OPENROUTER_API_KEY (Supabase optional)
npm install
```

`DEV_SKIP_AUTH=true` (the default in `.env.example`) lets you run with only the
Groq + OpenRouter keys — no Supabase needed (personality falls back to memory).

## Prove the pipeline (no server)

Drop an audio file in `test-assets/` and run:

```bash
npm run test:pipeline -- ./test-assets/sample.m4a --app WhatsApp --lang auto
```

Prints the raw transcript, cleaned text, timing, and usage. Try a Hinglish clip
with `--lang auto` to see the code-switching handling.

## Run the server

```bash
npm run dev      # watch mode (tsx)
# or
npm run build && npm start
```

## API contract

The wire types live in [`../shared/types/api.ts`](../shared/types/api.ts) — the
single source of truth shared with the apps. With `DEV_SKIP_AUTH=true`, any/no
token is accepted and mapped to a dev user.

| Mode    | Endpoint | In → Out |
|---------|----------|----------|
| Voice (one-shot) | `POST /v1/transcribe-clean` | multipart `audio` + `targetApp?`, `language?`, `personality?` → `{ cleanedText, transcript, usage }` |
| Voice (live) | `WS /v1/transcribe-stream` | `start` frame (token) → 16 kHz PCM frames → `stop`; receive `ready` → `partial`* / `final`* → `done` (see STREAMING.md) |
| Typing | `POST /v1/refine` | `{ text, targetApp?, language?, personality? }` → `{ refinedText, usage }` |
| Screen | `POST /v1/draft` | `{ screenContent, intent, recipient?, targetApp?, language?, personality? }` → `{ draftText, usage }` |
| Voice out | `POST /v1/speak` | `{ text, voice?, format?, instructions? }` → **binary audio** (TTS) |
| Profile | `GET` / `PUT /v1/personality` | the user's saved `Personality` |

Examples:

```bash
# Typing-refine
curl -X POST localhost:8080/v1/refine -H 'Content-Type: application/json' \
  -d '{"text":"hey can we meet kal at 5 i think","targetApp":"WhatsApp"}'

# Screen-reply draft
curl -X POST localhost:8080/v1/draft -H 'Content-Type: application/json' \
  -d '{"screenContent":"Can you join the review tomorrow 3pm?","intent":"politely say yes","targetApp":"Slack"}'

# Save a personality
curl -X PUT localhost:8080/v1/personality -H 'Content-Type: application/json' \
  -d '{"tone":"warm and concise","formality":"casual","emoji":"minimal","languages":["hinglish","en"]}'
```

## Personality + context

- **Personality** (tone, formality, emoji, languages, sign-off, custom notes) is
  saved per user (`GET`/`PUT /v1/personality`) and applied to every output. The
  app may also pass an inline `personality` override per request.
- **Context** = `targetApp` (and, for drafts, `recipient` + `screenContent`).

Both reach the model as data after the stable block of the `writer` role
(`src/principles/roles.ts`; the data is built in `src/pipeline/assistPrompt.ts`).
The screen reply's old prompt files stay in `../shared/prompts/` (`reply.v1.md`
to `reply.v4.md`) so `REPLY_PROMPT_VERSION=v4` can roll it back.

## Usage metering

Every successful request writes to Supabase `usage_events` (audio seconds + word
count). Apply the migrations in
[`supabase/migrations/`](supabase/migrations/) (usage + personalities). This is
the foundation for free-tier enforcement.

## Config knobs (env)

| Var                      | Purpose                                            |
|--------------------------|----------------------------------------------------|
| `STT_PROVIDER`           | `openai` (default, ~100 langs) or `groq`           |
| `OPENAI_STT_MODEL`       | OpenAI STT model (default `gpt-4o-transcribe`)      |
| `GROQ_STT_MODEL`         | Groq Whisper model (when `STT_PROVIDER=groq`)      |
| `CLEANUP_MODEL`          | OpenRouter model — **swap this one line** to change the LLM |
| `CLEANUP_PROMPT_VERSION` | Which `cleanup.<v>.md` to load (default `v2`)       |
| `REPLY_PROMPT_VERSION`   | The screen reply's prompt: `v5` (default) is the `writer` role, `v1` to `v4` are `reply.<v>.md` |
| `DEV_SKIP_AUTH`          | Skip Supabase auth + metering for local testing    |
