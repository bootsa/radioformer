# Decisions taken without asking

Choices made while Steph was away; each is easy to change. Newest last.

| # | Date | Decision | Alternative | How to change |
|---|---|---|---|---|
| D1 | 2026-11-24 | UPnP renderer lives in `packages/server/src/upnp`, not its own package | New package `@radioformer/upnp` | Move the folder; needs a lockfile and Dockerfile change |
| D2 | 2026-11-24 | Renderer forwards to the radio's own renderer (proxy) instead of playing audio itself | Radioformer fetches the stream and re-serves it | Replace `#control` in `renderer.ts` |
| D3 | 2026-11-24 | A cast switches the radio on and into the mode whose label matches "music player" | Do nothing and let the app fail | `UPNP_FACE_MODE`, or drop `prepare` |
| D4 | 2026-11-24 | Track details (DIDL metadata) are blanked in `SetAVTransportURI` | Pass through | `blankTrackDetails` in `renderer.ts` |
| D5 | 2026-11-24 | Event subscriptions to the radio are shared and relayed; callbacks use `UPNP_FACE_PUBLIC_URL` | Each app subscribes to the radio directly | `#subscription` |
| D6 | 2026-11-24 | The renderer's name is `Dancehall+` (`UPNP_FACE_NAME`), identity derived from the radio id | Another name | Environment variable in `rf.yml` |
| D7 | 2026-11-24 | Airable ids stored in a separate `directory_id` column; our own station id stays small | Use the Airable id as the primary key | Migration 7 and `stationItem` |
| D8 | 2026-11-24 | Matching to Airable stations is by name search with a human choosing | Automatic matching | Stations page |
| D9 | 2026-11-24 | Directory searches use an all-zero device id so no radio is identified to the service | Use the radio's id | `SEARCH_DEVICE` in `directory.ts` |
| D10 | 2026-11-24 | The stopped RadioAPI service is kept (not deleted) for now | Delete it | Coolify, FAMILY, radioapi |
