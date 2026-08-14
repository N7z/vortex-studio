# Vortex Studio MCP server

An MCP server that lets Claude Code build and refine Vortex Studio maps, either on an offline copy
or live in a session you are watching in the browser.

It is a client of the things that already exist rather than a second implementation of them. The map
model, the op format and every validity rule come from `live-editing-server/src/ops.js`, the same
module the editor itself imports, so the agent cannot invent a part shape the server would reject.

## What it gives the model

Maps here are not tiles. A map is a flat list of parts: boxes with a centre `P`, a full size `S`, a
rotation `R` in degrees, a colour, a material and optional per face textures. X and Z are the ground
plane, Y is up.

So the tools are built around what you actually do in a 3D block editor:

* **Structure** - `create_room` (floor, walls, ceiling and doorway openings in one action, and a
  pitched roof too if you pass `roof`), `create_roof` (two sloped slabs, overhanging eaves and the
  triangular gable ends filled, from a footprint and a pitch in degrees), `create_corridor`,
  `connect_rooms` (routes a corridor between two rooms *and* cuts the openings through the walls in
  the way), `create_stairs`, `carve_opening`, `fill_region`, `generate_terrain`.
* **Dressing** - `place_prop` and `scatter_props` over a prop library that carries the metadata the
  model needs: what the prop is for, whether it blocks movement, whether it is decorative, which
  settings it suits. `paint_region` restyles what is already there, `set_lighting` handles the
  ambient fill and the sun, and `attach_light` puts a point or spot light on a part so a lamp
  lights the room it stands in.
* **Precision** - `place_parts`, `modify_parts`, `move_parts`, `delete_parts` and `find_parts` for
  the corrections the semantic tools cannot express.
* **Organisation** - `group_parts`, `rename_folder` and `delete_folder`. Folders nest, so a building
  can hold its rooms, and a folder stays alive while it holds another one even after its own parts
  are gone. A part lives in exactly one folder, and the `folder` argument of `place_parts`,
  `place_prop` and `scatter_props` extends the folder it names instead of creating a second one with
  the same name, so a room stays one folder as the model adds to it. `create_room` still makes a folder per call, and says so when the name is
  already taken.
* **Judgement** - `render_map_preview` returns a real PNG the model can look at, `validate_map`,
  `analyze_walkability`, `analyze_density` and `get_map_statistics` catch what the eye misses.

Every tool commits exactly one undoable action, even when it places hundreds of parts, so `undo`
reliably reverses a whole room or scatter.

### Playability is checked against the real game

`get_map_constraints` reports the character constants straight out of
`resources/js/studio/play/movement.js`: 5 units tall, steps up 2, jumps 6.37. Builders refuse to make
a doorway the character cannot fit through or a stair it cannot climb, and `analyze_walkability`
samples every surface at every level, including floors under a ceiling, then flood fills from the
spawn to find areas nothing can reach.

### The preview is rendered without a GPU

Three.js needs WebGL, which Node does not have. Parts are oriented boxes, so this package rasterises
them itself: z buffer, per face shading, supersampling, PNG out. No native dependency, deterministic
output, and `Truss` parts are drawn see-through because they are lattices in the editor and drawing
them solid would mislead whoever is inspecting the picture.

## Setup

```bash
cd mcp-server
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | What it is |
| --- | --- |
| `STUDIO_URL` | where Laravel is serving, e.g. `http://127.0.0.1:8000` |
| `LIVE_URL` | the live editing server websocket, e.g. `ws://127.0.0.1:8787` |
| `LIVE_ORIGIN` | origin to present to the live server; must be in its `ALLOWED_ORIGINS` |
| `STUDIO_EMAIL` / `STUDIO_PASSWORD` | the Studio account the agent signs in as |

The agent signs in as **you**. It logs into Laravel with those credentials and asks
`/account/live-token?agent=1` for a signed identity, so it joins a room as `Your Name (MCP)` next to
your own `Your Name`, with exactly the permissions your account has. Live editing needs
`LIVE_SECRET` set in the Laravel `.env` and in `live-editing-server/.env`; without it the live
server cannot verify anyone and the agent can only join as a spectator.

### It needs no port of its own

This is a stdio server: Claude Code runs it as a local subprocess and talks to it over stdin and
stdout. It only ever makes outbound connections, so it opens nothing, listens on nothing, and needs
no proxy or firewall rule. It runs on the machine you run Claude Code on, not on your hosting, and
the single port your Node hosting gives you stays entirely with the live editing server.

To drive the deployed Studio instead of a local one, point it at production:

```
STUDIO_URL=https://studio.zpaulin.com
LIVE_URL=<the same endpoint VITE_LIVE_URL points at in production, as wss://>
LIVE_ORIGIN=https://studio.zpaulin.com
```

`LIVE_ORIGIN` has to be an origin the live server already allows, which the Studio origin is, so
nothing needs changing on the server side.

## Connecting Claude Code

```bash
claude mcp add vortex-studio -- node /absolute/path/to/vortex-studio/mcp-server/src/index.js
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "vortex-studio": {
      "command": "node",
      "args": ["/absolute/path/to/vortex-studio/mcp-server/src/index.js"]
    }
  }
}
```

## Live editing

1. Start Laravel, the live server and the Studio in a browser.
2. Open a map, hit **Live**, copy the room code.
3. Tell Claude to `connect_live` with that code.

From then on every tool call streams ops into the room the same way the browser does, so you watch
rooms appear as they are built, and edits you make yourself show up in the agent working copy. The
server still enforces roles: an agent that joins without a valid identity is a spectator and its
edits are refused.

Without `connect_live` the agent works on an offline copy: `load_map` to pull one down, `save_map` to
write it back.

## Tests

```bash
npm test
```

Covers the document model and undo, the geometry builders, the boolean carve, walkability and
validation, the renderer and PNG output, the tool schemas over a real stdio MCP client, and an
end to end live test that runs an actual live server and asserts a room built through the agent
arrives at a second connected client.
