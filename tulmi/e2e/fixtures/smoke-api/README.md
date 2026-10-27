# smoke-api

A tiny items API with no dependencies. Run it with `npm start`, test it with `npm test`.

## Endpoints

- `GET /health` returns `{ "ok": true, "service": "<name>" }`.
- `GET /items?page=1&limit=10` lists items, newest last. Pages start at 1. `limit` is at most 100.
- `GET /items/:id` returns one item.
- `POST /items` with `{ "name": "...", "price": 1.5 }` creates an item and answers 201.
- `DELETE /items/:id` removes an item and answers 204.

Every client is rate limited (see `src/ratelimit.js`).
