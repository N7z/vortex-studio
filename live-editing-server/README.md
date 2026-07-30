# Vortex Studio — live editing server

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
| `role` `{memberId, role}` | owner | `developer` or `spectator` |
| `kick` `{memberId}` | owner | remove someone |
| `saved` | owner | you just persisted the map to Laravel |
| `resync` | anyone | ask for the authoritative map again |
| `ping` | anyone | replied to with `pong` |

Server to client: `welcome`, `members`, `op`, `snapshot`, `selection`, `you` (your role
or ownership changed), `saved`, `kicked`, `error`, `pong`.

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
