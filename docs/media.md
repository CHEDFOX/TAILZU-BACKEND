# Media and files: reading what a person attaches

A person attaches a PDF, a Word file, a spreadsheet, a picture, a recording, a video or a zip, and asks about it. Tailzu **reads the file once**, keeps what it found, and answers from **the few chunks that matter** instead of sending the file to a model. Code: `tulmi/src/media/` (the work), `tulmi/src/routes/files.ts` (the door for big files), `media-worker/` (the Python service). Migration: `tulmi/supabase/migrations/0036_media.sql`. Deploy: `DEPLOY.md`, "Media and files".

It is **off unless `MEDIA_INGEST=true`**. Off, the front door's attachment registry says "coming soon" for these kinds, exactly as before, and every `/v1/files` route answers `404 { "code": "media_off" }`.

* [1. The flow](#1-the-flow)
* [2. What is a file: typing by bytes](#2-what-is-a-file-typing-by-bytes)
* [3. How each kind is read, and the caps](#3-how-each-kind-is-read-and-the-caps)
* [4. Read once, kept thirty days](#4-read-once-kept-thirty-days)
* [5. A question gets a few chunks](#5-a-question-gets-a-few-chunks)
* [6. In the front door, and the file routes](#6-in-the-front-door-and-the-file-routes)
* [7. A spreadsheet as a chart or a table](#7-a-spreadsheet-as-a-chart-or-a-table)
* [8. "Add this logo to the project"](#8-add-this-logo-to-the-project)
* [9. Safety](#9-safety)
* [10. The worker](#10-the-worker)
* [11. Configuration](#11-configuration)
* [12. Tests, and what needs a live check](#12-tests-and-what-needs-a-live-check)

## 1. The flow

```
 a file (inline in POST /v1/ask, or POST /v1/files for a big one)
   │  sniff: the kind from the BYTES (never the name, never the client's word); password, bomb and "not a kind we read" are refused here, in words
   │  cap for the kind; SHA-256; already read for this person?  ──yes──►  nothing is read again; the expiry is renewed
   ▼
 extract, by kind ── image: metadata stripped │ pdf: unpdf, or the worker (Docling) │ office: the worker (MarkItDown) │ csv: our parser │ text: decoded
   │                   audio: Deepgram │ video: the worker (frames + sound) then Deepgram │ zip: listed and its text files read, with bomb guards
   ▼
 chunk (about 900 characters, at headings, blank lines, table rows; each keeps its heading and page)
   │  secret scan, chunk by chunk (the policy's scanner): a chunk that looks like it holds a secret is replaced by a marker BEFORE it is stored
   ▼
 keep: bytes → R2 (u/<user>/<sha256>)   text + chunks + metadata → media_items / media_chunks (full-text index)   expires in 30 days unless kept
   ▼
 a question → the first chunk (to orient) + the chunks full-text search ranks highest, in file order, ≤ 3,500 characters,
              wrapped as untrusted data → the reply model
```

## 2. What is a file: typing by bytes

`sniff.ts`. A name and a MIME type are claims. `holiday.png` can be a zip, `invoice.pdf` a program, `notes.txt` a picture. The kind comes from the signature at the head of the bytes, and for the container formats from what is inside them:

| Found | By |
| --- | --- |
| png, jpeg, gif, webp | their signatures |
| pdf | `%PDF-` within the first kilobyte |
| docx, xlsx, pptx | a zip with `[Content_Types].xml` and `word/document.xml`, `xl/workbook.xml` or `ppt/presentation.xml` |
| odt, ods, odp, epub | a zip whose first entry is `mimetype` and says so |
| zip | anything else that is a zip |
| mp3, wav, flac, ogg, aac, m4a, mp4, mov, webm, mkv, avi, flv | their headers (`ftyp` brands tell sound from video) |
| text, code, csv, tsv, json, xml, html, svg | no NUL, few control characters; decodes (UTF-8, UTF-16 by its mark, else Windows-1252). Here, and only here, **the name picks between prose, code and a table**; it can never turn a binary into anything |

Refused with a sentence a person can read: a password-protected Office file (an encrypted OLE container), a password-protected or damaged zip, a zip bomb. Reported `unsupported`, with how to fix it: old binary Office files (`.doc`, `.xls`, `.ppt`), HEIC and AVIF pictures, RTF, gzip, 7z, RAR, tar, programs, and bytes that are none of the above. The front door's attachment kinds gained `document`, `data` and `archive` (`types.ts` `attachmentKindOf`).

## 3. How each kind is read, and the caps

A file over its cap is refused before anything is read from it. Nothing is over 50 MB (the multipart limit, and the most an attachment ref may say).

| Kind | Cap | Path | Notes |
| --- | ---: | --- | --- |
| image | 10 MB | metadata stripped (`strip.ts`); the **vision tier** describes it **once**, for the question asked, through the existing image handler (role `front_look`) | JPEG keeps only its orientation, as a bare 34-byte EXIF block; PNG, WebP and GIF lose text, EXIF and XMP. More than 100 megapixels is a bomb. A picture over 4 MB is made smaller by the worker before the vision tier sees it |
| pdf | 25 MB | **`unpdf`** (MIT, pinned 1.9.1) in Node, page by page. A **scanned** PDF (under 40 characters a page) or a **garbled** text layer goes to the **worker (Docling)**; so does one the caller marks `hardPdf` | encrypted: refused, "password-protected". 1,000 pages at most |
| docx, xlsx, pptx, odt, ods, odp, epub, html | 25 MB each | the **worker**: MarkItDown (docx, pptx, xlsx, epub, html), our own reader for OpenDocument. A deck is one section a slide, the slide number as the page. HTML without a worker is stripped to text in Node | |
| csv, tsv | 10 MB | parsed here (`tabular.ts`, RFC 4180): **facts over every row** (sum, range, commonest values), then the rows as a markdown table. Also kept as a `DataTable` (500 rows, 40 columns) | see section 7 |
| xlsx, ods | 25 MB | the worker also returns each visible sheet's rows (openpyxl, cached values, formulas never evaluated) | see section 7 |
| text, code | 1 MB | decoded; code is cut by lines, each chunk headed `lines A-B` | a small one (32 KB or less) sent with the message is read the front door's own way, nothing stored |
| audio | 50 MB | **Deepgram**, the same key, model and language rule as dictation (`DEEPGRAM_API_KEY`, `DEEPGRAM_STT_MODEL`, `DEEPGRAM_LANGUAGE`), with paragraphs and timestamps: `[1:05] what was said` | |
| video | 50 MB | the **worker**: **scene-change key frames (at most 8)** with ffmpeg, and a mono 16 kHz sound track. **Deepgram** makes the transcript; the **vision tier** reads **three frames at most**, once | 20 minutes at most. Frames are kept as `u/<user>/<sha>/f<n>.jpg` |
| zip | 50 MB | listed, and the **text and code inside are read** (40 files, 256 KB each, 2 MB in all). Binary entries are listed, not read. A nested zip is listed, not opened | guards: 500 entries, 200 MB declared, 100× per entry (over a megabyte) and 100× overall, 4 GB zip64 marker, an entry bigger than it said, encrypted entries, names that leave the folder |

A docx, xlsx, pptx, odt or epub is a zip too, so it passes the same guards **before** the worker sees it (and again inside the worker).

## 4. Read once, kept thirty days

* **By SHA-256, per person.** `media_items` has one row for each `(user_id, sha256)`. The same bytes again are not read again: no worker, no Deepgram, no vision call. Someone else's identical file is read for them and stored under their own key. Two reads of one file at once are one read.
* **What is stored.** The database keeps what a file *says*: `media_items` (kind, format, size, the text with secrets taken out, metadata: pages, duration, size, a zip's entries, a video's frames, the sheets' rows, notes said to the person) and `media_chunks` (the text in pieces; a generated `tsvector`, GIN index). Both have **owner-only RLS**: a person's token can read its own rows and nothing else; the server writes with the service key. A refused file never gets a row.
* **The bytes** go to **Cloudflare R2** through its S3 API (`blob.ts`), signed by **our own SigV4 signer** (`sigv4.ts`, no AWS SDK), at `u/<user id>/<sha256>`: one object per person per file, and one person's key can never name another's. Without R2 configured the text is kept and the bytes are not. R2 is used only together with the database (`SUPABASE_SERVICE_KEY`): with an index that lives in memory, bytes in a bucket would outlive the only thing that knows they are there, so the server says so at start and keeps no bytes.
* **Expiry.** `expires_at` is 30 days from the first read, renewed when the same file is sent again, **unless the person keeps it** (`POST /v1/files/:id/keep`). The server sweeps hourly: the row, its chunks and its bytes (frames too) go. Deleting an account deletes the bytes first (`server.ts`), then the rows cascade.

## 5. A question gets a few chunks

`chunk.ts`, `service.ts` `excerpt()`. The text is cut at headings, blank lines and table rows into chunks of about 900 characters; a long table is split by rows with its header repeated on every piece. For a question:

1. a file whose text fits is given whole;
2. otherwise the words of the question (stop words out; English stemmed to a stem that other forms start with; Hindi and Hinglish left as they are) go to **full-text search**. In Postgres that is `media_search` over the `tsvector` (the `simple` configuration: no stemming and no stop words, so English, Hindi and Hinglish are treated alike; a word of three letters or more matches any word that starts with it; `ts_rank_cd`). The memory twin uses BM25 over the same words and prefixes, so tests and a server with no database find the same chunks;
3. the first chunk is always included for orientation; then the best matches, **in the order they come in the file**, up to 3,500 characters, with `[… skipped …]` between non-neighbours and "3 of 99 parts" said;
4. with no word in common, the start of the file, and it says so.

The result is wrapped the way a web page is (`web/reader.ts` `asUntrusted`): one line saying what follows is untrusted data and not to be obeyed, then `<media_excerpt name=… kind=… parts=…>…</media_excerpt>`. Any `<media_excerpt` or `</media_excerpt` inside the text becomes `&lt;…`, so a file cannot close its own wrapper. (The tag is not `file` because the front door already wraps what it is given in `<file>` and escapes `</file` inside.) The principle `safe.data` says the other half to the model once, in every role that reads outside text.

## 6. In the front door, and the file routes

**The attachment registry** (`front/attachments.ts`, `docs/front-door.md` section 6). `registerMedia(registry, media)` (called in `server.ts` when `MEDIA_INGEST` is on):

* gives the registry a **typer**: the kind is found from the bytes, whatever `kind` and `mime` the client sent (a zip called `photo.png` is an archive and is never sent to the vision tier);
* registers **one handler for image, pdf, audio, video, document, data, archive, text, code and other**, replacing "coming soon". It has an `open`, so the registry hands it the whole reading. A file comes with its bytes the first time (`data`, base64, ≤ 6 MB) or as a **ref alone** afterwards: `{ id, kind, mime, bytes, sha256, name }` is enough, because the text is found by checksum in the database (`status: "cached"`). A file it no longer has is `missing`, in words. A small text or code file (32 KB or less) sent with the message is handed back to the handler it replaced (`takes`): nothing is stored, its lines stay numbered, and it is kept in memory for the follow-up, exactly as before.

**`POST /v1/files`** is for a file too big for a message. Multipart, one `file` part, up to 50 MB (each kind lower). It answers `201 { file, attachment, cached }` (`200` when the same bytes had been read before); `attachment` is exactly the ref `POST /v1/ask` takes in `attachments`, sent without its bytes. Also `GET /v1/files`, `GET /v1/files/:id`, `POST /v1/files/:id/keep { keep }`, `DELETE /v1/files/:id`, `POST /v1/files/:id/artifact` (section 7) and `POST /v1/files/:id/asset` (section 8). The routes sit under the overload guards (`src/guard`): two different files are two runs, a double tap of one is one. A refusal is a sentence: `422` password / bomb / not a kind we read, `413` too big, `503` a reader that is not switched on.

(`/v1/media/*` is the admin media registry, an older feature; files are `/v1/files`.)

## 7. A spreadsheet as a chart or a table

A CSV, TSV, xlsx or ods is parsed to rows. The front door (`dispatch.ts`) then **offers** the person a table and, when there is a column of numbers and two rows, a chart: one-tap buttons in `result.offers` (`visuals: "off"` turns them off). Taking the **table** has the reply lead with a markdown table (the existing inline rung). Taking the **chart** (or asking "chart this") makes it **by code, with no model and no cost**: `media/dataartifact.ts` writes a React artifact with recharts (the first text column along the bottom, up to four number columns, lines when the points are many) and creates it through the artifact core (`ArtifactService.create`), so the core's own checks apply (size, secrets, imports, no network). Every cell goes in as an escaped value. `POST /v1/files/:id/artifact { kind: "chart" | "table" }` does the same for an app that is not using the front door; a table is an HTML page with a sticky header.

## 8. "Add this logo to the project"

`media/assets.ts` `insertAsset()`, over the Code bot's **workspace**, so the policy and the size limits apply.

1. The picture: the bytes kept, with metadata already stripped.
2. **The use** decides the size on the longest side, never bigger than the original: logo 512, icon 256, favicon 128, avatar 256, thumbnail 480, hero 1920, banner 1600, photo 1600.
3. **The format is the project's**: webp or png, whichever its own pictures mostly are (read from its file tree), else png for what is drawn (logo, icon, favicon, avatar) and webp for what is photographed.
4. **The worker** (Pillow) resizes, converts, turns it upright and strips every byte of metadata; if the result is over 1 MB it is made again smaller (1, ¾, ½, ⅓ of the size), and in the end refused in words. Without the worker the picture goes in as it is (metadata stripped here) if it is small enough, and the notes say it was not resized.
5. An **SVG** is text: refused if it has a script, an event handler, `foreignObject`, a `javascript:` link, an embedded document, entity declarations, or anything loaded from another address; otherwise committed as it is.
6. **Where**: the folder the project already keeps its pictures in, else `public/`, `src/assets/` or `assets/`; a name that is taken gets `-2`, `-3`.
7. **Committed with `workspace().commit`**. A picture is a `CommitFile` with `encoding: "base64"` (`code/github.ts`): written as a blob first, then named in the tree. On a branch Tailzu made it is done; on any other it is the policy's question (`commit.other_branch`), answered by sending the same request with `approvalId`. A path out of the repo is refused as for any file. The secret scan, the 1 MB limit and the approval's digest all see the same base64 text, so a picture is exempt from nothing a text file is held to; an approval is bound to the exact bytes.

The route makes a work branch and a draft pull request when no `branch` is given. The front door does not decide this from a person's words yet (there is no `asset` road, and `front_decisions.route` has a fixed list): the app offers "add to project" on a picture and calls `POST /v1/files/:id/asset`.

## 9. Safety

* **Typed by bytes.** The extension and the MIME type decide nothing.
* **Secret-scanned.** Every chunk goes through the policy's `scanForSecrets` before it is stored; a flagged chunk is replaced by `(withheld: this part looked like it held a secret)`, never stored, found or shown, and the person is told. What reaches a model also goes through `forModel` as before.
* **Never executed.** Nothing in a file is run: formulas are cached values, macros are ignored, scripts in HTML and SVG are dropped or refused, PDFs are asked for text only. The worker runs no file's code.
* **Data, not instructions.** Wrapped, labelled, unable to close its wrapper (section 5).
* **Password-protected is refused, in words**: Office files, PDFs, zips, ODF, DRM'd EPUBs.
* **Bombs.** Zip entry count, declared size, expansion ratio, lying sizes and zip64 (`zip.ts`, again in `media-worker/app/zipguard.py`); a picture's pixel count (100 MP here, 50 MP in the worker); a video's length; a PDF's pages.
* **Privacy.** Picture metadata is stripped before storage. Nothing about a file is in a log. The worker's errors never repeat what a parser said (it can quote the file).

## 10. The worker

`media-worker/`: FastAPI, Python 3.13, a Dockerfile. It does what Node should not: **MarkItDown** (MIT) for office files, **Docling** (MIT) for scanned and complex PDFs, **Pillow** for pictures, **ffmpeg** for video.

| Endpoint | Does |
| --- | --- |
| `GET /healthz` | what is installed; no secret needed, nothing about any file |
| `POST /v1/convert?format=docx\|xlsx\|pptx\|odt\|ods\|odp\|epub\|html` | → `{ markdown, pages, tables, notes }` |
| `POST /v1/pdf` | Docling → `{ markdown, pages, notes }`, pages split by a form feed |
| `POST /v1/image?max=&format=auto\|webp\|png\|jpeg&quality=` | → the picture, with `X-Image-Width`, `-Height`, `-Format` |
| `POST /v1/video` | → `{ duration, width, height, frames[≤8], audio, notes }` |

* **Signed requests** (`security.py`, mirrored in `src/media/worker.ts`): `X-Tailzu-Timestamp` (within 60 s), `X-Tailzu-Nonce` (used once; remembered 2 minutes, bounded), and an HMAC-SHA256 with `MEDIA_WORKER_SECRET` over `v1 / time / nonce / METHOD / path?query / SHA-256(body)`. The headers are checked before the body is read; only a genuine request uses up its nonce; the comparison is constant-time. Both test suites check the same known signature.
* **Strict caps and timeouts** (`config.py`): body 30 MB for documents and PDFs, 15 MB for pictures, 60 MB for video; time 120 s, 240 s, 30 s and 300 s; memory 2, 6, 1.5 and 3 GB; `WORKER_CONCURRENCY` jobs at once (default 2), else `503 busy`.
* **Each job is a child process** (`isolate.py`) in its own session with `RLIMIT_AS`, `RLIMIT_CPU`, `RLIMIT_FSIZE`, a private temp folder, an environment without the secret, and the whole process group killed at the clock. A crash or a limit is "failed" in words, never a traceback.
* **No network calls out.** The compose network `media` is `internal: true` (only the backend is on it with the worker), and `netguard.py` makes any internet socket an error inside the job. Docling's models are baked into the image at build time; `HF_HUB_OFFLINE=1`; remote services and plugins are off in Docling, builtins and plugins off in MarkItDown (no audio transcription, YouTube or Wikipedia converters).
* **Licences** (`licenses_check.py`, run by `pytest` and by the image build): no AGPL, no GPL, no SSPL, no BSL, no PolyForm, no NonCommercial, no OpenRAIL; PyMuPDF, Marker, Surya and MinerU are refused by name. **None of the 120 packages installed for development, Docling and torch included, is denied.** The direct dependencies: fastapi, uvicorn, python-multipart, pillow, markitdown, openpyxl, defusedxml, docling, pypdfium2, torch and torchvision (CPU builds), all MIT, BSD, Apache-2.0 or MIT-CMU (`certifi` MPL-2.0, `tqdm` MPL-2.0 AND MIT). **ffmpeg** is a program: Debian's build is GPL-enabled, so it is only ever **run**, as a separate process inside our own container, never linked into the worker and never shipped on to anyone. If that ever changes, use an LGPL build (decoding, MJPEG and MP3 encoding are all it is asked for).
* **Pinned**: `requirements.txt` has the direct pins, `requirements.lock` every transitive one (the runtime closure, CPU torch), and the image is built from the lock.

## 11. Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `MEDIA_INGEST` | `false` | the feature; off, "coming soon" and `404 media_off` |
| `MEDIA_WORKER_URL`, `MEDIA_WORKER_SECRET` | none | the worker; `http://media-worker:8000` and `openssl rand -hex 32` (**secret**, `.env` only, the same on the worker). Without them: office files, scanned PDFs, video and shrinking pictures say what is not switched on; text-layer PDFs, CSV, text, code, zip, pictures and sound still work |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | none | the bucket (**`R2_SECRET_ACCESS_KEY` is a secret**, `.env` only). Without all four the bytes are not kept |
| `MEDIA_KEEP_DAYS` | `30` | how long a file lives unless kept |
| `DEEPGRAM_API_KEY`, `DEEPGRAM_STT_MODEL`, `DEEPGRAM_LANGUAGE` | existing | sound and the sound of a video |

Worker side (compose passes them): `MEDIA_WORKER_SECRET`, `WORKER_CONCURRENCY` (`MEDIA_WORKER_CONCURRENCY`), `MEDIA_WORKER_MEMORY` (6g), `MEDIA_WORKER_CPUS` (2).

## 12. Tests, and what needs a live check

Free tests (no network, no model, no database), in `tulmi/tests/ingest-*.test.ts`: `ingest-sniff` (magic bytes, names that lie, password, containers), `ingest-sigv4` (AWS's published signatures), `ingest-zip` (the bomb guards), `ingest-strip` (metadata), `ingest-chunks` (chunking, relevance, the untrusted wrapper, CSV), `ingest-blob` (R2 conventions over a fake), `ingest-worker` (signing, the worker's and Deepgram's answers), `ingest-service` (read once, expiry, caps, every kind, secrets, excerpts), `ingest-attach` (the registry, a spreadsheet's chart through the artifact core), `ingest-assets` (through the real policy over a fake GitHub), `ingest-routes`. Worker tests: `media-worker/tests` (`python -m pytest`): they make docx, xlsx, pptx, odt, epub, PDF, pictures and a video on the fly (real MarkItDown, real Pillow, real ffmpeg); Docling is replaced by a fake converter, because its models are fetched at image build time.

To run the worker's tests: `cd media-worker && python3 -m venv .venv && . .venv/bin/activate && pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.lock && pip install -r requirements-dev.txt && python -m pytest` (the virtualenv is git-ignored; the lock installs the CPU build of torch). `python licenses_check.py` prints every package with its licence and exits 1 if one is not allowed.

**Needs a live check** (nothing here can know):

* the **Docker image builds** and Docling's models download (`docker compose --profile media build media-worker`), and a **real scanned PDF** reads well: table cell accuracy and the time a page takes on the VPS's CPU;
* **R2** accepts our signed requests (the signer matches AWS's published examples, but only R2 can say so): a first upload, a get, a delete;
* **Postgres full-text search on Hindi and Hinglish** in Supabase's collation: the `simple` configuration splits words by the database's locale, and Devanagari combining marks are the known risk. English was checked against a local Postgres 16, including prefix matching, RLS and the cascade;
* **Deepgram** on Hinglish recordings (`DEEPGRAM_LANGUAGE`), and the vision tier reading real pictures and video frames;
* the **reverse proxy** lets `POST /v1/files` through (nginx's default body limit is 1 MB).
