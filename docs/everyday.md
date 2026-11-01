# Everyday tools: live answers nobody has to connect

Flights, hotels, currency and weather, live, for every person, with **no sign-in of theirs and no app to connect**. The server calls free services itself; the bots use them as tools; what they find is drawn as cards under the answer, and every card links out. Nothing is booked or paid here.

Code: `tulmi/src/everyday/`, `tulmi/src/routes/everyday.ts`, `tulmi/src/experience/bots/screens/finds.ts`.

| Tool | Service | How | Cost |
| --- | --- | --- | --- |
| `flights_search` | Kiwi.com | its public MCP server, `https://mcp.kiwi.com` (no auth) | free |
| `hotels_search` | trivago | its public MCP server, `https://mcp.trivago.com/mcp` (no auth) | free |
| `currency_convert` | Frankfurter | `https://api.frankfurter.dev/v1` (central-bank reference rates) | free, commercial use fine |
| `weather` | MET Norway | the trip screens' own forecast (`src/places`) | free, commercial use fine |

Kiwi.com and trivago publish no terms for their MCP servers yet: read them again before a big launch, and keep the source lines on the cards.

## Who gets which

`everyday/tools.ts everydayKindsFor`: the Travel bot and any bot that searches the web (web or research on) get all four; Plan Ease gets currency and weather; Keylessbord and Xode get none. "Ask any bot" sends weather and currency questions to the Travel bot (`bots/door.ts`, `travel:live`).

## How it is kept safe and cheap

* **Only data reaches the model.** Both MCP servers return their own instructions ("render a table", "end with a fun fact"). They are never passed on: `flights.ts` and `stays.ts` read the fields we draw, links are https only, and the model reads a few lines per result (`cardLines`).
* **Places become the airports meant.** Kiwi read "Goa" as Genoa; India's cities and a few hubs go as airport codes (`airportOf`).
* **A day's allowance per person** (`EVERYDAY_DAILY`, 40 flight or hotel searches; currency and weather count a tenth), the same question answered from memory (flights and hotels 20 minutes, rates 6 hours, weather 30 minutes), and at most 6 calls out at once for the whole server.
* **Cards** are kept in memory for a day under an id the answer carries (`finds`), for their owner only: `GET /v1/everyday/finds/:id`. A restart forgets them; the answer's words stay.

## On the screen

Not a tab. Under an answer (flights with times, stops and a booking link; hotels with a photo, rating, price a night, perks and a deal link; the money converted; the next days' weather), a quiet **Live** row in Ask (Flights, Hotels, Weather, Currency: a tap writes a starter to edit and hands it to Travel bot), and **Search live** on Travel bot's page when there is a trip.

## Settings

`EVERYDAY=false` turns them all off; `EVERYDAY_OFF=stays,flights` leaves some out; `EVERYDAY_DAILY`; `EVERYDAY_FLIGHTS_URL`, `EVERYDAY_STAYS_URL`, `EVERYDAY_RATES_URL` point at another server.

## Tests

`tests/everyday.test.ts`: reading what the services send, airport codes and dates, the allowance and memory, who gets which tool, the cards on both clients, the route.
