# The editor and the official Studio document

The official desktop Studio's project file is the reference format, settled against
a project it wrote itself. `resources/js/studio/vortexProject.js` speaks it on
download and import, and the editor now models everything it carries. What follows
is what each field is and where it lives, so the next person does not have to read
four files to find out.

## The document, field by field

| official field | where it lives in the editor |
| --- | --- |
| `material` | `M` on the part, one of `MATERIALS` in `materials.js`; absent means Plastic |
| `lights[]` | a `lights` array beside `parts`, its own column, its own live message |
| `textures[]` | `Tx` on the part, `{ Top: 'Studs' }` keyed by face |
| `baseplate` | `Bp` on the part; `createNew` sets it on the slab it makes |
| `cast_shadow`, `anchored`, `can_collide` | `Cs`, `An`, `Cc`; absent means true |
| `project_id` | the `project_id` column, kept across exports and imports |

Every new part key is optional. That is what keeps every stored map, backup and
undo entry valid, and it is why the exporter reads them through the helpers in
`materials.js` rather than off the part directly.

## Where each one is enforced

A part shape is checked in three places and they have to agree:

- `live-editing-server/src/ops.js` — `PART_KEYS` and `validPart`, shared with the
  editor by import, so a live op and a save cannot disagree.
- `app/Http/Controllers/MapController.php` — `validParts`, `validTextures`,
  `validLights`. Rejects rather than repairs, same as it always did.
- `resources/js/studio/ops.js` — `repairParts`, which drops a bad value and counts
  it so the user is told the map was repaired.

Lights have the same three: `live-editing-server/src/lights.js` (`cleanLights`,
shared), `MapController::validLights`, and `repairLights` on the way in.

## Lights

`LightData` is `{name, position, rotation, color, illuminance, shadows_enabled}`.
Internally a light is `{_id, N, P, R, C, I, Sd}` with `R` in degrees, and it shines
along its own -Z, the convention everything else in the scene uses.

They are map data, not part data: a change replaces the whole array, travels as one
`lights` message, and does not go on the undo stack. The viewport builds one rig per
light — the light, its target, and a handle carrying the document's transform, which
is what the gizmo drives and what the marker hangs off. `DEFAULT_SUN` in
`lighting.js` is where the editor's old hardcoded sun went; a new map gets one.

Illuminance is in lux. `DEFAULT_ILLUMINANCE` is 10000, the value a light the desktop
Studio creates itself carries, and `SUN_PER_LUX` in `Viewport.jsx` is the divisor
that turns it back into the intensity the hardcoded sun had. The -Z convention is
not ours either: in the reference project the light at (50, 80, 30) has its -Z
pointing at the origin exactly.

Note for expectations: the game reads `parts` only — `lights` and `groups` are in
the document but unread by the engine (`docs/UPDATE_0_2_22.md` in VortexStuff). So
lighting is for parity with the desktop Studio, not something players will see.

## Checked against a real project

`scripts/project.test.mjs` (`npm test`) reads
`../VortexStuff/maps/studio-minimal-project.json` — a project the desktop Studio
wrote, with a group and a light in it — and asserts a full import/export round trip
comes back identical to it. That is what pins down the parts of the format a struct
dump left open, and it is the test to run after touching `vortexProject.js`:

- a part's `group` is an **integer index** into the top-level `groups`, or `null`.
  A string in either place is a type error to serde and rejects the whole file.
- `GroupData` is `{name, parent_group}` and carries **no id**. `parent_group` is the
  group's own parent, for nesting, and never appears on a part.
- the slab's `name` is `"Baseplate"`, the way a spawn's is `"SpawnLocation"`.
- a default is an absent key on our side, never an explicit one.

The reference checkout is a sibling of this one. Without it those tests skip rather
than fail, so this repo alone still runs green.

## How a material is drawn

The desktop app ships `materials/<name>_albedo|normal|orm.png`. Ours are scanned PBR
sets under `public/materials/`, built by `scripts/build-materials.sh` from an
ambientCG zip. The script does two things that are not a format change:

- **The base colour is flattened to greyscale.** A part's colour multiplies the
  albedo, so a green grass scan would fight the colour picker and there would be no
  such thing as red grass.
- **Its brightness is normalised to a common mean.** The scans are nowhere near each
  other — Ice measured 0.336 and plaster 0.745 — and without this the same picked
  colour would come out muddy on one material and bright on another. All five land
  on ~0.78, which is what makes them interchangeable under the picker.

Rerun it whenever a set is added or replaced; a material with no files on disk just
has none, which is Plastic by design and anything not built yet by accident.

`materialmaps.js` loads them and `parts3d.js` hangs them on the material. One ORM
texture is read twice: three.js takes roughness from its green channel and metalness
from its blue, which is how the file is packed. Its red is ambient occlusion, which
would need a second UV set and is left unread.

A stud or inlet is **composited into the albedo** rather than combined in a shader,
so the pair tiles as one texture and the grain stays locked to the studs however the
part is sized. `facemarks.js` exists so the mark can be drawn at the material's own
resolution: scaling the viewport's 64px tile up into a 512px albedo left the studs
soft against a sharp material.

`TILING` in `materialmaps.js` is how many studs one tile of material spans, per
material: a scan has a real-world size and they are not the same size, so ice reads
well tight while grass at the same tiling is fine noise rather than a lawn. The
composite's canvas grows with the tiling but caps at 1024, so past 16 studs a tile a
stud is drawn smaller than the 64px the viewport gives a bare one. The
shader patch divides the per-instance repeat by the same number, so the two cannot
drift apart. It is the table to edit when a material reads as noise (raise it) or as
wallpaper (lower it).

A set is *built* at one tile per stud and re-patched to the material's tiling only
when the maps actually arrive. That is not an optimisation: until then, and for good
on a material that ships no maps, the face carries nothing but the mark, which is one
per stud whatever the material would have wanted.

Which two of the part's three sizes the tiling uses is chosen in the shader from the
face's normal. Using x and z for every face is what smeared the sides of a slab into
vertical streaks — on a 100x2x100 part the side face was getting a tile 2 studs wide
and 0.04 tall, a 50:1 stretch.

## Still open

- Importing a project *into an already open map* takes its parts and groups and
  drops its lights and `project_id`. Merging two documents' lights has no obvious
  right answer, so it does nothing rather than guess.
- Version history stores parts and groups. Restoring a version leaves the map's
  lights and `project_id` as they are.
- Spawn and shirt faces get no material. Those marks are drawn once across the whole
  face, so compositing one would repeat the badge with the tiling.
- Transparent parts get no material either. They are drawn loose rather than
  instanced, and that is where the shader scales the tiling by the part's size, so
  the maps would stretch across the face instead of tiling.
- None of the material work has been looked at in a running viewport: this machine
  has no usable browser. The maths was checked by compositing the same way offline,
  which validates the tinting and the composite but not how it reads under lighting.

## Not in scope, on purpose

Moving the *internal* document to the official long-key shape. It would touch live
editing, backups, undo, the Lua plugin API (`part.T`, `part.P`) and every stored
map, for no user-visible gain: `vortexProject.js` translates at the boundary, which
is the only place the shape has to match.
