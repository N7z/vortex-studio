# Plan: bring the editor up to the official Studio document

The official desktop Studio's project file is now the reference format, settled
against a project it wrote itself. `resources/js/studio/vortexProject.js` already
speaks it on download and import. What follows is what the *editor* still does not
model, so the exporter has to invent it.

Everything below is a real gap, in the order I would take them: value first, and
the cheap ones before the ones that touch the live-editing path.

## What the format carries that we fill with constants today

| official field | what we export now | where the real value would come from |
| --- | --- | --- |
| `material` | always `"Plastic"` | a per-part property (Plastic, Wood, Metal, Grass, Ice, Paint) |
| `lights[]` | always `[]` | map-owned lights; today the sun is one hardcoded `DirectionalLight` in `Viewport.jsx` |
| `textures[]` | always `[]` | `faces` state, which is keyed by part id and never leaves the browser |
| `baseplate` | always `false` | an explicit flag; the editor has no baseplate concept |
| `cast_shadow`, `anchored`, `can_collide` | always `true` | per-part toggles the official properties panel has and we do not |
| `project_id` | fresh id every download | stored per map, so re-exporting keeps the project's identity |

## Phase 1 — per-part properties (materials and the three toggles)

Smallest change with the most visible payoff, and it unblocks the exporter.

1. Extend the internal part with optional short keys, the way `Shape`/`ItemId`
   already work: `M` (material), and the toggles. Optional keeps every stored map,
   backup and undo entry valid, and keeps the live-editing ops untouched.
2. `MapController::PART_KEYS` and `validParts()` have to accept them, or the
   server rejects the first save. Material is a string from a fixed set; the
   toggles are booleans. Reject anything else rather than repair it, same as the
   existing checks.
3. `Properties.jsx` gets a Material dropdown and the three checkboxes. The
   official panel groups them as Appearance (Color, Transparency, Material,
   Cast Shadow) and Behavior (Anchored, CanCollide, Truss) — worth copying, since
   Truss is already a part type here.
4. `parts3d.js` maps material to roughness/metalness so the viewport shows the
   difference. The desktop app ships `materials/<name>_albedo|normal|orm.png`; we
   do not need the textures to make Metal read as metal.
5. `vortexProject.js`: read the real values instead of the constants, both ways.

## Phase 2 — per-face textures

The official format stores them per part: `textures: [{"face":"Top","kind":"Studs"}]`,
faces `Front|Back|Top|Bottom|Left|Right`, kinds `Studs|Inlets`.

Ours live in `faces`, keyed by part id, outside the document — so they die with the
browser and never reach an export. Moving them onto the part is the same shape of
change as phase 1 (new optional key, server validation, exporter reads it), plus
draining the existing `faces` state into the parts once, the way `takeLegacyGroups`
drains the old localStorage groups.

## Phase 3 — lights

The biggest one, and the only one that needs new UI beyond a panel row.

`LightData` is `{name, position, rotation, color, illuminance, shadows_enabled}` —
a directional light with an explicit orientation. Work: a `lights` array beside
`parts` in the document, entries in the Explorer, selection and the move/rotate
gizmos working on a light, a properties panel for colour/illuminance/shadows, and
`Viewport.jsx` driving its sun from the map instead of the hardcoded one.

Server side, `lights` needs the same treatment `groups` already got: its own column
and its own validation, travelling with the save.

Note for expectations: the game reads `parts` only — `lights` and `groups` are in
the document but unread by the engine (`docs/UPDATE_0_2_22.md` in VortexStuff).
So lighting is for parity with the desktop Studio, not something players will see.

## Phase 4 — baseplate and project identity

- `baseplate` is one boolean on the part that `createNew` sets on the slab it
  makes. Worth doing with phase 1, it is the same plumbing.
- `project_id`: keep it with the map (a column, and in the local backup) so the
  same map keeps its id across exports. New maps mint one, imports keep whatever
  the file carried.

## Not in scope, on purpose

Moving the *internal* document to the official long-key shape. It would touch
live editing, backups, undo, the Lua plugin API (`part.T`, `part.P`) and every
stored map, for no user-visible gain: `vortexProject.js` already translates at the
boundary, which is the only place the shape has to match.
