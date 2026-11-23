# Radioformer: design note

Status: draft 1, 23 Nov 2026. Written before any code, to be argued with.

Radioformer is a small self-hosted server that stands in for the online service that Frontier Silicon
internet radios (Roberts, Hama, Medion, Technisat and others) were built to talk to. It started as a fork of
[Radio-API](https://github.com/KIMB-technologies/Radio-API) (GPL-3.0, PHP) and is being rewritten as a
TypeScript server with a SvelteKit web app. Radio-API is the inspiration and the reference for the radio
protocol; the old PHP code stays in `legacy/` until the new app has caught up.

## 1. Why a rewrite

Radio-API works, but in daily use with a Roberts Stream 94i we hit things it cannot do or does not do well:

- Many stations send now-playing text as XML (for example `<RadioInfo><Table>...` from Dalet systems used by
  Bauer's Portuguese stations), which the radio shows raw. Cleaning it up needs a stream-aware proxy.
- Stations that only publish HLS (`.m3u8`), which the radio cannot play.
- Searching is minimal and the web UI is dated.
- It is not designed to be driven by other systems (Home Assistant, Music Assistant, scripts).
- Home Assistant's Frontier Silicon integration can only select the radio's own stations/presets, not play a
  stream, so the server side is the only place where "play this on the radio" can be provided.

## 2. Goals and non-goals

Goals
1. A radio can find, browse, search and play stations and podcasts served by Radioformer, using the same
   wire protocol it uses today (XML for older radios; JSON for newer ones, later).
2. Clean now-playing text on the radio for stations that send XML or odd titles.
3. Playable HLS stations (optional, later).
4. A modern, fast web UI: search many sources at once, preview in the browser, manage stations and logos,
   see which radios have connected.
5. Modular: protocol, station sources, stream transformers, logo providers and integrations are separate
   packages with small interfaces.
6. Runs well on a Raspberry Pi 5 inside a container: low memory (target under 100 MB idle), arm64 and amd64.
7. Safe by default: no open proxy, no unauthenticated admin.

Non-goals (for now)
- Per-track cover art on the radio. Observed on the 94i: the radio fetches only the station logo, at start
  and when a station is chosen; it made no requests at all on song changes. We show station logos only.
- Replacing the radio's control channel (UNDOK / FSAPI). That is a separate protocol on the radio itself.
- Being a music library server.

## 3. What the radio actually does (from captured traffic)

Observed from a Roberts Stream 94i (firmware 2.14.35c, `fver=8`, vendor path `Roberts`, `ven=rob29`):

| Request | Purpose |
|---|---|
| `GET /setupapp/<vendor>/asp/BrowseXML/loginXML.asp?token=0` | Returns `<EncryptedToken>3a3f5ac48a1dab4e</EncryptedToken>` (fixed value is accepted) |
| `GET .../loginXML.asp?gofile=&mac=<hex>&dlang=eng&fver=8&ven=rob29` | Root menu as `<ListOfItems>` |
| `GET /list?tid=<n>&startItems=1&endItems=100&mac=...` | A list (stations, podcasts) with paging |
| `GET /?sSearchtype=3&Search=<id>&mac=...` | Item detail; with `&play` the stream URL |
| `GET /vtuner/play/stream=<uuid>` and `/vtuner/play/station=<id>` | Play endpoints for radio-browser items |
| `GET /radio-browser?by=country-all&term=France&offset=50` | Browse the radio-browser directory |
| `GET /setupapp/_/asp/BrowseXML/Search.asp?sSearchtype=2&startItems=...` | Search |
| `GET /FindUpdate.aspx?...` | Firmware check (answered with a redirect, never offering updates) |
| `GET /media/<logo>.png` | Station logo |

The radio identifies itself with a `mac` string (28 to 40 hex characters). Newer radios use a JSON API on
`airable.wifiradiofrontier.com:443` with an `Authorization` header (base64 of `<radio id>:<md5>`); self-signed
TLS is accepted. Both depend on the radio's DNS pointing `*.wifiradiofrontier.com` and
`*.internetradiofrontier.com` at this server (ports 80 and 443). The radio never falls back to its second DNS
server while the first one answers, so existing presets saved against the original service do not resolve.

The audio side: the radio opens the stream three or four times in quick succession, first without
`Icy-MetaData`, then with it, and decodes plain `https` AAC and MP3 but not HLS. It shows the stream's
`StreamTitle` text as-is.

All of the above is recorded as fixtures and replayed in tests (section 9).

## 4. Architecture

One process, several packages. A pnpm workspace monorepo:

```
packages/
  core/            types, station model, plugin interfaces, event bus, config schema
  protocol-xml/    Frontier XML protocol (older radios, first target)
  protocol-json/   Frontier JSON protocol (newer radios, later)
  sources/         StationSource plugins: own-list, radio-browser, podcast (later), import
  stream/          Stream proxy and StreamTransformers (ICY title cleaner, later HLS remux)
  logos/           Logo providers and a small PNG/resize pipeline
  api/             REST API (OpenAPI), server-sent events, auth
  server/          composes everything: HTTP listeners, TLS, DB, plugin registry, static web
apps/
  web/             SvelteKit (static adapter, SPA), served by `server`
legacy/            the PHP code (reference only, removed once not needed)
docs/
```

Stack choices, each with the reason:

- Node.js LTS with TypeScript (strict). Same language across server and web, small runtime, good streaming.
- Fastify 5 for HTTP: mature, fast, schema-based validation; streaming proxy uses `node:http`/`node:https`
  directly. (Alternative considered: Hono. Fastify's plugin model fits the module idea better.)
- SQLite through the built-in `node:sqlite`: no native build step on arm64, one file to back up.
  Hand-written, numbered SQL migrations. (Fallback: `better-sqlite3`.)
- Zod for config, API and plugin-boundary validation; types derive from schemas.
- SvelteKit 5 with `adapter-static` in SPA mode. SvelteKit rather than Astro because the UI is an
  application, not content. The server serves the built files; no Node server needed for the web app.
- Tests with Vitest; Playwright for a handful of web UI checks.
- Container: multi-stage Dockerfile, `node:lts-alpine`, non-root, read-only root filesystem, one volume
  `/data`. Built and published by GitHub Actions to `ghcr.io` for arm64 and amd64.

### Listeners

- `:8080` HTTP: radio protocol, the web app and `/api/v1`. Reverse proxies (Traefik in Coolify) send the
  radio hostnames and the admin hostname here.
- `:8443` HTTPS with a self-signed certificate generated on first start, for JSON radios.
- Optional `:8090` stream proxy can share `:8080` (path `/s/<station>`); a separate port is only a
  convenience.

## 5. Data model

SQLite tables (sketch):

- `radio` (id, mac, rid, label, first_seen, last_seen, last_ip): one row per physical radio.
- `station` (id, name, stream_url, logo_id, description, country, language, tags, transformer, proxy_mode,
  created_at, source, source_ref).
- `collection` and `collection_station`: folders and favourites shown on the radio and in the web app.
- `logo` (id, sha256, mime, width, height, origin).
- `podcast` and `episode` (later), `setting`, `user_session`.

Per-radio lists: all radios share one library by default (matching a typical household); per-radio
collections are possible.

`proxy_mode` is one of `direct` (the radio gets the upstream URL), `proxy` (the radio plays
`/s/<id>` from this server), `auto` (use proxy when a transformer is set or the upstream is HLS or needs
TLS the radio cannot do).

## 6. Plugin interfaces (the modular part)

All plugins are TypeScript modules registered at start-up; no dynamic code loading from the network.

```ts
interface StationSource {
  id: string;
  search(q: SearchQuery, signal: AbortSignal): Promise<StationHit[]>;   // free text + filters
  browse?(path: string[], page: Page): Promise<BrowseResult>;           // country, language, tag, ...
  resolve(ref: string): Promise<ResolvedStation>;                       // final stream URL, codec, logo
}

interface StreamTransformer {            // acts on ICY metadata blocks, audio is untouched
  id: string;
  title(raw: string, ctx: StreamContext): string;
}

interface LogoProvider {
  id: string;
  find(station: StationLike): Promise<LogoCandidate[]>;  // radio-browser favicon, station website, upload
}

interface Integration {                  // outward connections
  id: string;
  start(ctx: AppContext): Promise<void>; // subscribes to events: now playing, radio seen, ...
}
```

Built-ins: sources `own`, `radio-browser`; transformers `none`, `dalet-xml`, `regex`; logo providers
`upload`, `radio-browser`. Integration ideas, not scheduled: MQTT / Home Assistant discovery of "what the
radio is playing", webhooks, a Music Assistant bridge (section 8).

Events on an internal bus (`radio.seen`, `stream.started`, `stream.stopped`, `nowplaying.changed`) feed the
web app (server-sent events), the stats page and integrations.

## 7. Stream proxy

Goals: cleaner titles, HLS-only stations, TLS the radio cannot do.

- Upstream requests use HTTP/1.0 with `Icy-MetaData: 1` so servers do not use chunked encoding; redirects are
  followed (limit 3); timeouts on connect and idle.
- Audio is forwarded byte for byte. The proxy reads `icy-metaint` bytes, then one length byte and the
  metadata block, rewrites only `StreamTitle`, keeps other fields (`StreamUrl`, ad markers), and writes it
  back. Cost per stream: tens of small reads a second, negligible CPU.
- If the radio did not request metadata the proxy sends none (the 94i first connects without, then with).
- The `dalet-xml` transformer turns `<RadioInfo><Table><DB_DALET_ARTIST_NAME>..` into `Artist - Title`, falls
  back to the programme title, handles truncated blocks and XML entities. Verified on real Radio Comercial
  and M80 streams (a working prototype exists, see section 12).
- Safety: only stations stored in the database can be proxied (no URL parameter), upstream addresses that
  resolve to private ranges are refused unless the station was added by an admin with an explicit
  "local source" flag, a global cap on concurrent streams, and per-IP limits.
- HLS (later, optional): `ffmpeg -c copy` to a continuous ADTS/AAC stream, started on demand and stopped
  when the last listener leaves. Adds ffmpeg to the image, so it ships as a separate image tag.

## 8. Other systems

Home Assistant's Frontier Silicon integration can only choose the radio's own channels (its source code
rejects every media type except `channel`), and Music Assistant's UPnP route to these radios is reported
unreliable. The server side has one option those cannot offer: a station on the radio's list can point at a
stream made by this server. So the plan is:

1. A REST API and an event stream, so anything can read "what is playing" and manage stations.
2. A generic "inbound stream" station type: a station whose audio comes from a URL on this server.
   Whether Music Assistant can publish a continuous stream we can point at is unverified; the experiment
   comes after milestone 2, not before.
3. MQTT discovery for Home Assistant (sensors for connected radios and now playing) as an integration.

## 9. Testing

- Protocol contract tests: real requests and responses captured from the 94i (the log lines above, plus
  recordings made with a small capture script) are stored as fixtures and replayed against the server.
- A fake radio client script that performs the whole login, browse, play sequence, used in CI.
- Unit tests for transformers with captured ICY blocks (Dalet XML including truncated ones, ad markers,
  plain titles, accented characters).
- Stream proxy tests against a local fake Icecast server (with and without `icy-metaint`, redirects, slow
  clients).
- A few Playwright tests for the web app (search, add station, preview).

Acceptance for the first real use: the 94i can log in, browse, play Radio Comercial, M80 and FIP from our
own list with clean titles, with RadioAPI turned off.

## 10. Web app

Mobile-first, dark/light, keyboard friendly.

- Search: one box over all sources at once, filters for country, language, tag, codec and bitrate, results
  show whether the stream works (checked on demand), one click to add or to preview in the browser.
- Library: stations and collections, drag to order, bulk edit, per-station transformer and proxy mode.
- Logos: automatic suggestions from radio-browser, upload, and a preview of how it looks on the radio
  (small square PNG).
- Radios: connected radios, last seen, what they are playing, connection check and DNS hints.
- Settings, import (Radio-API export, M3U/PLS), export.
- Auth: a single admin with a password or token, stored hashed, in a cookie session; optional trusted
  reverse-proxy header (for Cloudflare Access or similar). The radio endpoints never need a login.

## 11. Milestones

| | Scope | Done when |
|---|---|---|
| M0 | Scaffold: workspace, TypeScript, lint, tests, Dockerfile, CI that publishes an image | `docker run` serves a health endpoint on arm64 |
| M1 | XML protocol, own stations in SQLite, stream proxy with ICY cleaning, import of Radio-API data, logos by upload | 94i plays our stations with clean titles; fixtures pass |
| M2 | REST API, web app (library, search over radio-browser, logos, radios page), auth | Everything M1 can be managed from a browser |
| M3 | Podcasts, JSON protocol for newer radios | Podcast episodes play; a JSON-API radio connects (needs one to test) |
| M4 | Integrations: events, MQTT/HA, inbound stream experiment, HLS remux | Each integration documented and tested |

## 12. What already exists

- A working prototype of the metadata proxy (Python, about 200 lines) runs on the Pi at
  `http://192.168.222.241:8090/<name>` for Radio Comercial, M80 and FIP. Its logic and test samples are
  ported into `packages/stream` in M1, and the container is retired afterwards.
- RadioAPI (PHP) stays up as the live service until M1 is accepted.

## 13. Risks and open questions

- Protocol coverage: older radios from other vendors may use other vendor paths or fields. We only have one
  radio to test with; the design keeps vendor-specific bits in `protocol-xml` configuration.
- Licence: porting protocol behaviour closely from Radio-API makes the result a derivative of GPL-3.0 code.
  The project stays GPL-3.0, and `LICENSE` and attribution are kept.
- `node:sqlite` is newer than `better-sqlite3`; we will check it on the Pi early and fall back if needed.
- Image conversion for logos needs a native library (`sharp`). Prebuilt arm64 binaries exist; the fallback
  is a WASM encoder.
- Name: "Radioformer" is the working name from the repository.
- DNS: the radio needs its DNS pointed here. A bundled DNS responder (UDP 53) could be added later; for now
  the existing `radio_dns` container does that.
