import {
    DEG, boundsOf, boxOfRegion, overlaps, partBounds, partsInRegion, regionBounds, rng, round,
    roundVec,
} from './geom.js';
import { MapError } from './doc.js';
import { PLAY, buildProp, palette } from './catalog.js';

const EPS = 1e-6;

export const SIDES = ['north', 'south', 'east', 'west'];

const surface = (fields, fallback) => ({ ...fallback, ...(fields ?? {}) });

function styleOf(options) {
    const pal = options.palette ? palette(options.palette) : null;
    if (options.palette && !pal) {
        throw new MapError(`unknown palette "${options.palette}"`);
    }

    const pick = (role, given) => {
        const out = { ...(pal?.[role] ?? {}) };
        if (given?.material) out.M = given.material;
        if (given?.color) out.C = String(given.color).replace(/^#/, '').toLowerCase();
        if (!out.M) out.M = 'Plastic';
        if (!out.C) out.C = role === 'floor' ? '6f6c67' : '7d7a74';

        return out;
    };

    return {
        floor: pick('floor', options.floor),
        wall: pick('wall', options.wall),
        ceiling: pick('ceiling' in (pal ?? {}) ? 'ceiling' : 'wall', options.ceiling),
        light: pal?.light ?? 'ffffff',
    };
}

export function subtractBox(part, hole) {
    const b = partBounds(part);
    if (!overlaps(b, hole)) return [part];

    const [rx, ry, rz] = part.R ?? [0, 0, 0];
    if (rx || ry || rz) return null;

    const pieces = [];
    const push = (minX, maxX, minY, maxY, minZ, maxZ) => {
        if (maxX - minX <= EPS || maxY - minY <= EPS || maxZ - minZ <= EPS) return;
        pieces.push({
            ...part,
            P: roundVec([(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]),
            S: roundVec([maxX - minX, maxY - minY, maxZ - minZ]),
        });
    };

    const cutMinX = Math.max(b.minX, hole.minX);
    const cutMaxX = Math.min(b.maxX, hole.maxX);
    const cutMinY = Math.max(b.minY, hole.minY);
    const cutMaxY = Math.min(b.maxY, hole.maxY);

    push(b.minX, cutMinX, b.minY, b.maxY, b.minZ, b.maxZ);
    push(cutMaxX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ);
    push(cutMinX, cutMaxX, b.minY, cutMinY, b.minZ, b.maxZ);
    push(cutMinX, cutMaxX, cutMaxY, b.maxY, b.minZ, b.maxZ);
    push(cutMinX, cutMaxX, cutMinY, cutMaxY, b.minZ, Math.max(b.minZ, hole.minZ));
    push(cutMinX, cutMaxX, cutMinY, cutMaxY, Math.min(b.maxZ, hole.maxZ), b.maxZ);

    return pieces;
}

export function carvePlan(parts, region) {
    const hole = regionBounds(region);
    const removed = [];
    const added = [];
    const skipped = [];

    for (const part of partsInRegion(parts, region)) {
        const pieces = subtractBox(part, hole);
        if (pieces === null) {
            skipped.push(part._id);
            continue;
        }
        if (pieces.length === 1 && pieces[0] === part) continue;
        removed.push(part._id);
        for (const piece of pieces) {
            const { _id, ...rest } = piece;
            added.push(rest);
        }
    }

    return { removed, added, skipped };
}

export function carveAll(parts, regions) {
    const original = new Set(parts.map((p) => p._id));
    let working = parts;
    let minted = 0;
    const skipped = [];

    for (const region of regions) {
        const plan = carvePlan(working, region);
        skipped.push(...plan.skipped);
        if (!plan.removed.length) continue;
        const gone = new Set(plan.removed);
        working = [
            ...working.filter((p) => !gone.has(p._id)),
            ...plan.added.map((p) => {
                minted += 1;

                return { ...p, _id: `pending-${minted}` };
            }),
        ];
    }

    const alive = new Set(working.map((p) => p._id));

    return {
        removed: [...original].filter((id) => !alive.has(id)),
        added: working.filter((p) => !original.has(p._id)).map(({ _id, ...rest }) => rest),
        skipped: [...new Set(skipped)],
    };
}

function wallRun(axis, start, end, fixed, thickness, y, height, fields, openings) {
    const parts = [];
    const spans = [];
    let cursor = start;
    const sorted = [...openings].sort((a, b) => a.from - b.from);

    for (const gap of sorted) {
        const from = Math.max(start, gap.from);
        const to = Math.min(end, gap.to);
        if (to <= from) continue;
        if (from > cursor) spans.push([cursor, from]);
        if (gap.height < height) {
            const lintelY = y + gap.height;
            parts.push(makeWall(axis, from, to, fixed, thickness, lintelY, height - gap.height, fields));
        }
        cursor = Math.max(cursor, to);
    }
    if (cursor < end) spans.push([cursor, end]);

    for (const [from, to] of spans) {
        parts.push(makeWall(axis, from, to, fixed, thickness, y, height, fields));
    }

    return parts;
}

function makeWall(axis, from, to, fixed, thickness, y, height, fields) {
    const region = axis === 'x'
        ? {
            x: from, y, z: fixed, width: to - from, height, depth: thickness,
        }
        : {
            x: fixed, y, z: from, width: thickness, height, depth: to - from,
        };

    return boxOfRegion(region, fields);
}

function doorSpans(doorways, side, wallFrom, wallTo, height) {
    const out = [];
    for (const d of doorways) {
        if (d.side !== side) continue;
        const width = d.width ?? 8;
        const centre = d.offset ?? (wallFrom + wallTo) / 2;
        const from = centre - width / 2;
        if (from < wallFrom - EPS || from + width > wallTo + EPS) {
            throw new MapError(
                `a ${width} wide doorway centred at ${centre} does not fit on the ${side} wall `
                + `(which runs ${round(wallFrom)}..${round(wallTo)})`,
            );
        }
        const h = d.height ?? Math.min(height, 12);
        if (h < PLAY.bodyHeight + 1) {
            throw new MapError(
                `a doorway ${h} high is too short: the character is ${PLAY.bodyHeight} tall, use at least ${PLAY.bodyHeight + 1}`,
            );
        }
        out.push({ from, to: from + width, height: Math.min(h, height) });
    }

    return out;
}

export function buildRoom(options) {
    const {
        x, z, width, depth, y = 0, height = 14,
    } = options;
    const t = options.wallThickness ?? 2;
    const floorThickness = options.floorThickness ?? 2;
    const doorways = options.doorways ?? [];

    if (width <= t * 2 || depth <= t * 2) {
        throw new MapError(
            `a ${width}x${depth} room with ${t} thick walls has no inside; make it bigger or the walls thinner`,
        );
    }
    if (height < PLAY.bodyHeight + 2) {
        throw new MapError(
            `a ceiling ${height} high is too low to walk under: the character is ${PLAY.bodyHeight} tall`,
        );
    }
    for (const d of doorways) {
        if (!SIDES.includes(d.side)) throw new MapError(`doorway side must be one of ${SIDES.join(', ')}`);
    }

    const style = styleOf(options);
    const parts = [];

    if (options.floor !== false) {
        parts.push(boxOfRegion({
            x, y: y - floorThickness, z, width, height: floorThickness, depth,
        }, { ...style.floor, Tx: options.studs === false ? undefined : { Top: 'Studs' } }));
    }

    const north = doorSpans(doorways, 'north', x, x + width, height);
    const south = doorSpans(doorways, 'south', x, x + width, height);
    const west = doorSpans(doorways, 'west', z, z + depth, height);
    const east = doorSpans(doorways, 'east', z, z + depth, height);

    parts.push(...wallRun('x', x, x + width, z, t, y, height, style.wall, north));
    parts.push(...wallRun('x', x, x + width, z + depth - t, t, y, height, style.wall, south));
    parts.push(...wallRun('z', z + t, z + depth - t, x, t, y, height, style.wall, west));
    parts.push(...wallRun('z', z + t, z + depth - t, x + width - t, t, y, height, style.wall, east));

    if (options.ceiling) {
        parts.push(boxOfRegion({
            x, y: y + height, z, width, height: floorThickness, depth,
        }, style.ceiling));
    }

    return parts;
}

// A gable roof is two slabs leaning against a ridge, plus the triangle of wall each end that the
// slabs leave open. Boxes cannot be triangles, so the gable filler is a thick slab lying in the
// roof plane whose spare depth is buried inside the walls below.
export function buildRoof(options) {
    const {
        x, z, width, depth, y,
    } = options;
    const thickness = options.thickness ?? 1;
    const overhang = options.overhang ?? 1;
    const gableThickness = options.gableThickness ?? 2;
    const acrossZ = (options.ridge ?? (width >= depth ? 'x' : 'z')) === 'x';
    const span = acrossZ ? depth : width;
    const along = acrossZ ? width : depth;
    const pitch = options.pitch ?? 34;

    if (pitch <= 0 || pitch >= 80) {
        throw new MapError(`a ${pitch} degree pitch is not a roof; use something between 5 and 70`);
    }
    if (span <= 0 || along <= 0) throw new MapError('a roof needs a positive width and depth');

    const rad = pitch * DEG;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const half = span / 2;
    const rise = half * Math.tan(rad);
    const ridgeY = y + rise;
    const centreAcross = (acrossZ ? z + depth / 2 : x + width / 2);
    const centreAlong = (acrossZ ? x + width / 2 : z + depth / 2);
    const style = styleOf(options);
    const roofStyle = { ...style.wall };
    if (options.color) roofStyle.C = String(options.color).replace(/^#/, '').toLowerCase();
    if (options.material) roofStyle.M = options.material;

    // Positive rx tips the +Z edge down; positive rz tips the +X edge up, hence the sign flip.
    const tilt = (positive) => (acrossZ
        ? [positive ? pitch : -pitch, 0, 0]
        : [0, 0, positive ? -pitch : pitch]);
    const at = (across, height) => (acrossZ
        ? [centreAlong, height, across]
        : [across, height, centreAlong]);
    const sized = (acrossSize, height) => (acrossZ
        ? [along + overhang * 2, height, acrossSize]
        : [acrossSize, height, along + overhang * 2]);

    const slabLength = half / cos + overhang;
    const parts = [];
    for (const positive of [true, false]) {
        const dir = positive ? 1 : -1;
        parts.push({
            T: 'Part',
            P: roundVec(at(centreAcross + dir * (slabLength / 2) * cos, ridgeY - (slabLength / 2) * sin)),
            S: roundVec(sized(slabLength, thickness)),
            R: tilt(positive),
            ...roofStyle,
        });
    }

    if (options.gables !== false) {
        const fill = rise * cos + (options.gableDepth ?? 4);
        const face = half / cos;
        for (const positive of [true, false]) {
            const dir = positive ? 1 : -1;
            // Midpoint of the slab underside, then straight down the slope normal by half the fill.
            const midAcross = centreAcross + dir * (face / 2) * cos;
            const midY = ridgeY - (face / 2) * sin;
            const across = midAcross - dir * (fill / 2) * sin;
            const height = midY - (fill / 2) * cos;
            for (const end of [0, 1]) {
                const edge = acrossZ
                    ? x + (end ? width - gableThickness / 2 : gableThickness / 2)
                    : z + (end ? depth - gableThickness / 2 : gableThickness / 2);
                const P = acrossZ ? [edge, height, across] : [across, height, edge];
                const S = acrossZ ? [gableThickness, fill, face] : [face, fill, gableThickness];
                parts.push({
                    T: 'Part', P: roundVec(P), S: roundVec(S), R: tilt(positive), ...style.wall,
                });
            }
        }
    }

    return {
        parts,
        ridgeY: round(ridgeY),
        rise: round(rise),
        pitch,
        ridge: acrossZ ? 'x' : 'z',
        slabLength: round(slabLength),
    };
}

export function buildCorridor(options) {
    const {
        width = 8, height = 12, y = 0,
    } = options;
    const t = options.wallThickness ?? 2;
    const floorThickness = options.floorThickness ?? 2;
    const style = styleOf(options);
    const parts = [];

    const legs = options.legs ?? routeLegs(options.from, options.to, options.bend ?? 'x');

    for (const leg of legs) {
        const horizontal = leg.axis === 'x';
        const lo = Math.min(leg.from, leg.to);
        const hi = Math.max(leg.from, leg.to);
        if (hi - lo <= EPS) continue;

        const region = horizontal
            ? {
                x: lo, z: leg.fixed - width / 2, width: hi - lo, depth: width,
            }
            : {
                x: leg.fixed - width / 2, z: lo, width, depth: hi - lo,
            };

        parts.push(boxOfRegion({
            ...region, y: y - floorThickness, height: floorThickness,
        }, { ...style.floor, Tx: options.studs === false ? undefined : { Top: 'Studs' } }));

        if (options.walls !== false) {
            if (horizontal) {
                parts.push(boxOfRegion({
                    x: lo, y, z: region.z - t, width: hi - lo, height, depth: t,
                }, style.wall));
                parts.push(boxOfRegion({
                    x: lo, y, z: region.z + width, width: hi - lo, height, depth: t,
                }, style.wall));
            } else {
                parts.push(boxOfRegion({
                    x: region.x - t, y, z: lo, width: t, height, depth: hi - lo,
                }, style.wall));
                parts.push(boxOfRegion({
                    x: region.x + width, y, z: lo, width: t, height, depth: hi - lo,
                }, style.wall));
            }
        }

        if (options.ceiling) {
            parts.push(boxOfRegion({
                ...region, y: y + height, height: floorThickness,
            }, style.ceiling));
        }
    }

    return parts;
}

export function routeLegs(from, to, bend) {
    const [x1, z1] = from;
    const [x2, z2] = to;

    if (Math.abs(x1 - x2) < EPS) {
        return [{ axis: 'z', fixed: x1, from: z1, to: z2 }];
    }
    if (Math.abs(z1 - z2) < EPS) {
        return [{ axis: 'x', fixed: z1, from: x1, to: x2 }];
    }

    if (bend === 'z') {
        return [
            { axis: 'z', fixed: x1, from: z1, to: z2 },
            { axis: 'x', fixed: z2, from: x1, to: x2 },
        ];
    }

    return [
        { axis: 'x', fixed: z1, from: x1, to: x2 },
        { axis: 'z', fixed: x2, from: z1, to: z2 },
    ];
}

export function trimLegs(legs, fromBounds, toBounds) {
    const out = legs.map((l) => ({ ...l }));
    const clip = (leg, bounds, atStart) => {
        const forward = leg.to >= leg.from;
        const lo = leg.axis === 'x' ? bounds.minX : bounds.minZ;
        const hi = leg.axis === 'x' ? bounds.maxX : bounds.maxZ;
        const edge = atStart === forward ? hi : lo;

        if (atStart) leg.from = forward ? Math.max(leg.from, edge) : Math.min(leg.from, edge);
        else leg.to = forward ? Math.min(leg.to, edge) : Math.max(leg.to, edge);
    };

    clip(out[0], fromBounds, true);
    clip(out[out.length - 1], toBounds, false);

    return out.filter((l) => Math.abs(l.to - l.from) > EPS);
}

export function junctionBoxes(legs, { width, height, y, margin }) {
    if (!legs.length) return [];
    const at = (leg, atStart) => {
        const along = atStart ? leg.from : leg.to;

        return leg.axis === 'x'
            ? {
                x: along - margin,
                y,
                z: leg.fixed - width / 2,
                width: margin * 2,
                height,
                depth: width,
            }
            : {
                x: leg.fixed - width / 2,
                y,
                z: along - margin,
                width,
                height,
                depth: margin * 2,
            };
    };

    return [at(legs[0], true), at(legs[legs.length - 1], false)];
}

export function buildStairs(options) {
    const {
        from, to, width = 8, steps: wanted,
    } = options;
    const rise = to[1] - from[1];
    if (Math.abs(rise) < EPS) throw new MapError('stairs need a height difference between from and to');

    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const run = Math.hypot(dx, dz);
    if (run < EPS) throw new MapError('stairs need horizontal distance between from and to');
    if (Math.abs(dx) > EPS && Math.abs(dz) > EPS) {
        throw new MapError('stairs must run along X or Z, not diagonally');
    }

    const steps = Math.max(1, Math.round(wanted ?? Math.max(Math.abs(rise) / 1.5, 2)));
    const stepRise = rise / steps;
    if (Math.abs(stepRise) > PLAY.stepHeight) {
        throw new MapError(
            `each step would rise ${round(Math.abs(stepRise))}, above the ${PLAY.stepHeight} the character can walk up. Use more steps`,
        );
    }

    const style = styleOf(options);
    const alongX = Math.abs(dx) > EPS;
    const stepRun = run / steps;
    const signX = Math.sign(dx);
    const signZ = Math.sign(dz);
    const parts = [];

    for (let i = 0; i < steps; i++) {
        const top = from[1] + stepRise * (i + 1);
        const base = Math.min(from[1], to[1]) - 2;
        const startAlong = i * stepRun;
        const region = alongX
            ? {
                x: signX > 0 ? from[0] + startAlong : from[0] - startAlong - stepRun,
                z: from[2] - width / 2,
                width: stepRun,
                depth: width,
            }
            : {
                x: from[0] - width / 2,
                z: signZ > 0 ? from[2] + startAlong : from[2] - startAlong - stepRun,
                width,
                depth: stepRun,
            };

        parts.push(boxOfRegion({
            ...region, y: base, height: top - base,
        }, style.floor));
    }

    return parts;
}

export function buildTerrain(options) {
    const {
        x, z, width, depth, y = 0,
    } = options;
    const cell = Math.max(options.cell ?? 8, 1);
    const amplitude = options.amplitude ?? 8;
    const roughness = options.roughness ?? 0.5;
    const next = rng(options.seed ?? 1);
    const style = styleOf(options);

    const cols = Math.max(1, Math.round(width / cell));
    const rows = Math.max(1, Math.round(depth / cell));
    if (cols * rows > 4000) {
        throw new MapError(
            `that is ${cols * rows} terrain blocks; raise "cell" or shrink the area to stay under 4000`,
        );
    }

    const heights = [];
    for (let r = 0; r <= rows; r++) {
        heights.push([]);
        for (let c = 0; c <= cols; c++) {
            const wave = Math.sin(c * 0.6) * Math.cos(r * 0.5);
            const noise = (next() - 0.5) * 2 * roughness;
            heights[r].push(((wave * (1 - roughness)) + noise) * amplitude);
        }
    }

    const parts = [];
    const base = y - (options.thickness ?? 6);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const avg = (heights[r][c] + heights[r][c + 1] + heights[r + 1][c] + heights[r + 1][c + 1]) / 4;
            const top = y + Math.round(avg * 2) / 2;
            parts.push(boxOfRegion({
                x: x + c * cell,
                y: base,
                z: z + r * cell,
                width: cell,
                height: Math.max(top - base, 1),
                depth: cell,
            }, style.floor));
        }
    }

    return parts;
}

export function scatterProps(options, existing) {
    const {
        region, props, count,
    } = options;
    const next = rng(options.seed ?? 1);
    const box = regionBounds(region);
    const spacing = options.spacing ?? 0;
    const placed = [];
    const taken = options.avoidOverlap === false
        ? []
        : partsInRegion(existing, region).map(partBounds);

    let tries = 0;
    const limit = count * 40;

    while (placed.length < count && tries < limit) {
        tries++;
        const id = props[Math.floor(next() * props.length) % props.length];
        const x = box.minX + next() * (box.maxX - box.minX);
        const z = box.minZ + next() * (box.maxZ - box.minZ);
        const yaw = options.randomYaw === false ? 0 : Math.floor(next() * 4) * 90;

        const parts = buildProp(id, {
            x: round(x, 2),
            y: region.y,
            z: round(z, 2),
            yaw,
            seed: Math.floor(next() * 1e6),
            color: options.color,
            material: options.material,
        });

        const bounds = boundsOf(parts);
        const padded = {
            minX: bounds.minX - spacing,
            maxX: bounds.maxX + spacing,
            minY: bounds.minY,
            maxY: bounds.maxY,
            minZ: bounds.minZ - spacing,
            maxZ: bounds.maxZ + spacing,
        };

        if (options.avoidOverlap !== false && taken.some((b) => overlaps(padded, b))) continue;
        if (bounds.minX < box.minX || bounds.maxX > box.maxX
            || bounds.minZ < box.minZ || bounds.maxZ > box.maxZ) continue;

        taken.push(bounds);
        placed.push({ prop: id, at: [round(x, 2), region.y, round(z, 2)], yaw, parts });
    }

    return { placed, tries };
}
