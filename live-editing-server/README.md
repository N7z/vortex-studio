# Paulin Studio — live editing server

Websocket room server for the studio's **live team editing**. It is a plain Node
process that lives in this repo for convenience only: Laravel never starts it, never
talks to it, and does not need it running. With this server down the editor works
exactly as it did before, single-player.

```
npm install
cp .env.example .env      # optional, the defaults are the same
npm start                 # listens on :8787
npm test                  # 53 tests, no browser needed
```

Then point the editor at it with `VITE_LIVE_URL` in the studio's `.env`:

```
VITE_LIVE_URL=ws://localhost:8787
```

## In production: it has to be `wss://`

A browser on an `https://` page may not open a `ws://` socket — it is blocked outright
("This operation is insecure"), and no header or CSP directive permits it. So something
in front of this process has to terminate TLS.

`VITE_LIVE_URL` accepts either an absolute URL or a **bare path** (`/live`), in which
case the host and the scheme come from the page itself — `wss://` in production and
`ws://` locally, with one value to maintain. Note it is baked in at **build time**:
changing it means `npm run build` and redeploying `public/build`.

### Behind Cloudflare (`wss://ws.example.com`)

The four things that actually bite:

- **Port.** Cloudflare only proxies certain ports, and for `wss://` (443) the valid
  origin ports are 443, 2053, 2083, 2087, 2096 and 8443 — **8787 is not one of them**,
  and by default Cloudflare connects to the origin on the same port it received. Either
  add an **Origin Rule** rewriting the destination port to 8787, or listen on 8443 and
  point the client at `wss://ws.example.com:8443`.
- **The DNS record must be proxied** (orange cloud). Grey cloud means the browser
  reaches the origin directly over plain `ws://`, which is the error you started with.
- **`ALLOWED_ORIGINS` is the page's origin, not the socket's.** The browser sends the
  `Origin` of the site (`https://example.com`), never `ws.example.com`. Get this wrong
  and the upgrade is refused with a 403 that looks like the server being down.
- **SSL/TLS mode.** With this process on plain http, Cloudflare has to reach the origin
  over http, which is *Flexible* — a zone-wide setting. Scope it to the websocket
  hostname with a Configuration Rule, or install a Cloudflare **Origin CA certificate**
  here and keep Full (strict).

Cloudflare closes a WebSocket idle for ~100 s. That is already covered: the heartbeat
pings every `HEARTBEAT_SECONDS` (25 by default), which counts as traffic.

## What it is responsible for

Rooms are held **in memory** and are authoritative for the *order* of edits, nothing
else. Laravel remains the only thing that persists a map: the room owner's editor keeps
saving through `PUT /api/maps/{name}` exactly as it always has. Losing this process to a
restart costs the live session, never the map.

Everything the editor and the server both need to agree on lives in `src/ops.js`, and
the browser imports that same file (`resources/js/studio/ops.js` re-exports it). Two
copies of `applyOp` that drifted apart would silently desynchronise clients, so there is
one copy and both sides run it.

## Roles

A room has one **owner** (whoever opened it, and it passes to the longest-present member
if they leave), plus **developers** and **spectators**. Everyone arrives as a spectator
and the owner grants editing deliberately; the server refuses ops from spectators rather
than trusting the client to grey out its own buttons. Only the owner can change roles,
remove people, or replace the whole map.

Display names are generated (`Happy Capybara`) and unique within the room. There are no
accounts, matching the rest of the studio.

## Protocol

JSON text frames, `t` is the type. Client to server:

| message | who | meaning |
| --- | --- | --- |
| `create` `{mapName, parts}` | anyone | open a room, become its owner |
| `join` `{code}` | anyone | join an existing room |
| `op` `{op}` | developers | one edit, see `src/ops.js` |
| `selection` `{ids}` | developers | what you have selected, for the others' outlines |
| `view` `{view}` | anyone | `{p, d}` camera position and facing, for the others' markers |
| `groups` `{groups}` | developers | the explorer folders, mirrored to the room |
| `role` `{memberId, role}` | owner | `developer` or `spectator` |
| `kick` `{memberId}` | owner | remove someone |
| `saved` | owner | you just persisted the map to Laravel |
| `resync` | anyone | ask for the authoritative map again |
| `ping` | anyone | replied to with `pong` |

Server to client: `welcome`, `members`, `op`, `snapshot`, `selection`, `view`, `groups`,
`you` (your role or ownership changed), `saved`, `kicked`, `error`, `pong`.

An accepted op is broadcast to **everyone, the sender included**. The sender already
applied it optimistically and every op is idempotent, so the echo costs nothing and acts
as a receipt. A refused op is answered with an `error` *and* a `snapshot`, because a
client whose optimistic edit was rejected is now ahead of the room and a full snapshot is
the only honest way back.

## Notes on the behaviour that is easy to get wrong

- **A room outlives its last member** by `ROOM_GRACE_SECONDS`, which is what lets
  everybody reload the page, or ride out a flaky connection, without losing the session.
- **Half-open sockets** (a laptop that slept) never fire `close`, so there is a
  ping/pong heartbeat; without it people who left would sit in the member list looking
  present.
- **Part data is validated here too**, not only in PHP. The room is what the owner
  eventually saves, so junk from one client would reach every other viewport before
  Laravel ever saw it.
- **The `Origin` header is checked during the upgrade**, so a rejected browser gets a
  403 it can read instead of a socket that opens and immediately closes. Set
  `ALLOWED_ORIGINS` in production; the default `*` is for development.
