import {
    boundsOf, intersectionVolume, overlaps, partBounds, regionBounds, round,
} from './geom.js';
import { MAX_JUMP_HEIGHT, PLAY, LIMITS } from './catalog.js';

const collides = (p) => p.Cc !== false;
const anchored = (p) => p.An !== false;

export function surfaceField(parts, { cell = 4, region = null, maxCells = 90_000 } = {}) {
    const solid = parts.filter(collides);
    const bounds = region ? regionBounds(region) : boundsOf(solid);
    if (!bounds) return null;

    const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
    const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    if (cols < 1 || rows < 1) return null;
    if (cols * rows > maxCells) {
        const suggested = Math.ceil(cell * Math.sqrt((cols * rows) / maxCells));

        throw new Error(
            `that area needs ${cols * rows} cells at cell size ${cell}, over the ${maxCells} budget. `
            + `Pass cell >= ${suggested} or analyse a smaller region.`,
        );
    }

    const boxes = solid.map((p) => ({ part: p, b: partBounds(p) }));
    const cells = new Array(cols * rows);

    for (let r = 0; r < rows; r++) {
        const cz = bounds.minZ + (r + 0.5) * cell;
        for (let c = 0; c < cols; c++) {
            const cx = bounds.minX + (c + 0.5) * cell;
            const spans = [];
            for (const { part, b } of boxes) {
                if (cx < b.minX || cx > b.maxX || cz < b.minZ || cz > b.maxZ) continue;
                spans.push({ from: b.minY, to: b.maxY, part });
            }
            cells[r * cols + c] = mergeSpans(spans);
        }
    }

    return {
        cell, cols, rows, bounds, cells,
    };
}

function mergeSpans(spans) {
    if (!spans.length) return [];
    spans.sort((a, b) => a.from - b.from);
    const out = [];
    let current = { from: spans[0].from, to: spans[0].to, parts: [spans[0].part] };

    for (let i = 1; i < spans.length; i++) {
        const s = spans[i];
        if (s.from <= current.to + 1e-6) {
            if (s.to > current.to) current.to = s.to;
            current.parts.push(s.part);
        } else {
            out.push(current);
            current = { from: s.from, to: s.to, parts: [s.part] };
        }
    }
    out.push(current);

    return out;
}

export function surfaces(field, need) {
    const out = [];
    for (let i = 0; i < field.cells.length; i++) {
        const stack = field.cells[i];
        for (let level = 0; level < stack.length; level++) {
            const span = stack[level];
            const above = stack[level + 1];
            const headroom = above ? above.from - span.to : Infinity;
            out.push({
                index: i,
                level,
                y: span.to,
                headroom,
                standable: headroom >= need,
                spawn: span.parts.some((p) => p.T === 'SpawnLocation' && Math.abs(
                    partBounds(p).maxY - span.to,
                ) < 1e-6),
            });
        }
    }

    return out;
}

export const JUMP_DISTANCE = PLAY.walkSpeed * ((2 * PLAY.jumpVelocity) / Math.abs(PLAY.gravity));

export function walkability(parts, options = {}) {
    const field = surfaceField(parts, options);
    if (!field) {
        return {
            standableCells: 0, reachableCells: 0, unreachable: [], islands: [], field: null,
        };
    }

    const { cols, rows, cell, bounds } = field;
    const need = PLAY.bodyHeight;
    const all = surfaces(field, need).filter((s) => s.standable);
    const jumps = options.allowJump !== false;
    const climb = jumps ? MAX_JUMP_HEIGHT : PLAY.stepHeight;
    const reach = jumps ? Math.max(1, Math.round(JUMP_DISTANCE / cell)) : 1;

    const byCell = new Map();
    for (const s of all) {
        if (!byCell.has(s.index)) byCell.set(s.index, []);
        byCell.get(s.index).push(s);
    }

    const key = (s) => `${s.index}:${s.level}`;
    const label = new Map();
    const islands = [];

    const neighbours = (s) => {
        const r = Math.floor(s.index / cols);
        const c = s.index % cols;
        const out = [];

        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let step = 1; step <= reach; step++) {
                const nc = c + dc * step;
                const nr = r + dr * step;
                if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) break;
                const here = byCell.get(nr * cols + nc) ?? [];
                const gap = (step - 1) * cell;
                // Height and distance trade off: you cannot clear the longest gap
                // at the top of the jump.
                const ceiling = step === 1
                    ? climb
                    : climb * Math.max(0, 1 - gap / JUMP_DISTANCE);
                let landed = false;
                for (const other of here) {
                    const rise = other.y - s.y;
                    if (rise > ceiling) continue;
                    out.push(other);
                    landed = true;
                }
                if (landed || !jumps) break;
            }
        }

        return out;
    };

    for (const start of all) {
        if (label.has(key(start))) continue;
        const id = islands.length;
        const members = [];
        const queue = [start];
        label.set(key(start), id);

        while (queue.length) {
            const s = queue.pop();
            members.push(s);
            for (const other of neighbours(s)) {
                if (label.has(key(other))) continue;
                label.set(key(other), id);
                queue.push(other);
            }
        }

        const xs = members.map((s) => bounds.minX + ((s.index % cols) + 0.5) * cell);
        const zs = members.map((s) => bounds.minZ + (Math.floor(s.index / cols) + 0.5) * cell);
        const ys = members.map((s) => s.y);

        islands.push({
            id,
            cells: members.length,
            area: round(members.length * cell * cell),
            hasSpawn: members.some((s) => s.spawn),
            bounds: {
                minX: round(Math.min(...xs)),
                maxX: round(Math.max(...xs)),
                minZ: round(Math.min(...zs)),
                maxZ: round(Math.max(...zs)),
            },
            floorY: round(Math.min(...ys)),
            averageY: round(ys.reduce((a, b) => a + b, 0) / ys.length),
        });
    }

    islands.sort((a, b) => b.cells - a.cells);
    const spawned = islands.filter((i) => i.hasSpawn);
    const main = spawned.length ? spawned : islands.slice(0, 1);
    const mainIds = new Set(main.map((i) => i.id));

    return {
        cell,
        standableCells: all.length,
        reachableCells: islands.filter((i) => mainIds.has(i.id)).reduce((n, i) => n + i.cells, 0),
        islands,
        unreachable: islands.filter((i) => !mainIds.has(i.id)),
        field,
    };
}

export function findOverlaps(parts, { tolerance = 0.05, limit = 200, includeBaseplate = false } = {}) {
    // Sinking a floor into the ground slab is normal here, so a baseplate is not
    // an overlap worth reporting unless asked for.
    const considered = includeBaseplate ? parts : parts.filter((p) => !p.Bp);
    const boxes = considered.map((p) => ({ part: p, b: partBounds(p) }));
    boxes.sort((a, b) => a.b.minX - b.b.minX);
    const hits = [];

    for (let i = 0; i < boxes.length && hits.length < limit; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[j].b.minX >= boxes[i].b.maxX - tolerance) break;
            if (!overlaps(boxes[i].b, boxes[j].b, tolerance)) continue;
            const volume = intersectionVolume(boxes[i].b, boxes[j].b);
            const smallest = Math.min(
                boxes[i].part.S[0] * boxes[i].part.S[1] * boxes[i].part.S[2],
                boxes[j].part.S[0] * boxes[j].part.S[1] * boxes[j].part.S[2],
            );
            hits.push({
                a: boxes[i].part._id,
                b: boxes[j].part._id,
                volume: round(volume),
                fractionOfSmaller: round(smallest > 0 ? volume / smallest : 0, 3),
                at: [
                    round((Math.max(boxes[i].b.minX, boxes[j].b.minX)
                        + Math.min(boxes[i].b.maxX, boxes[j].b.maxX)) / 2),
                    round((Math.max(boxes[i].b.minY, boxes[j].b.minY)
                        + Math.min(boxes[i].b.maxY, boxes[j].b.maxY)) / 2),
                    round((Math.max(boxes[i].b.minZ, boxes[j].b.minZ)
                        + Math.min(boxes[i].b.maxZ, boxes[j].b.maxZ)) / 2),
                ],
            });
            if (hits.length >= limit) break;
        }
    }

    return hits;
}

export function findUnsupported(parts, { limit = 100 } = {}) {
    const boxes = parts.map((p) => ({ part: p, b: partBounds(p) }));
    const out = [];

    for (const { part, b } of boxes) {
        if (!anchored(part)) continue;
        if (part.Bp) continue;
        const under = boxes.some(({ part: other, b: ob }) => other._id !== part._id
            && ob.maxY >= b.minY - 0.25 && ob.maxY <= b.minY + 0.25
            && ob.minX < b.maxX && ob.maxX > b.minX
            && ob.minZ < b.maxZ && ob.maxZ > b.minZ);
        const touching = boxes.some(({ part: other, b: ob }) => other._id !== part._id
            && overlaps(ob, b, -0.25));
        if (!under && !touching && b.minY > 0.25) {
            out.push({ id: part._id, at: part.P.map((v) => round(v)), bottomY: round(b.minY) });
        }
        if (out.length >= limit) break;
    }

    return out;
}

export function statistics(parts, groups, lights) {
    const bounds = boundsOf(parts);
    const byType = {};
    const byMaterial = {};
    const byColor = {};
    let volume = 0;
    let decorative = 0;
    let noCollide = 0;
    let unanchored = 0;

    for (const p of parts) {
        byType[p.T] = (byType[p.T] ?? 0) + 1;
        const m = p.M ?? 'Plastic';
        byMaterial[m] = (byMaterial[m] ?? 0) + 1;
        const c = p.C ?? 'a3a2a5';
        byColor[c] = (byColor[c] ?? 0) + 1;
        volume += p.S[0] * p.S[1] * p.S[2];
        if (p.Cc === false) noCollide += 1;
        if (p.Cc === false && p.Cs === false) decorative += 1;
        if (p.An === false) unanchored += 1;
    }

    const palette = Object.entries(byColor)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([color, n]) => ({ color, parts: n }));

    return {
        parts: parts.length,
        groups: groups.length,
        lights: lights.length,
        partBudget: { used: parts.length, limit: LIMITS.maxParts },
        bounds: bounds ? {
            minX: round(bounds.minX),
            maxX: round(bounds.maxX),
            minY: round(bounds.minY),
            maxY: round(bounds.maxY),
            minZ: round(bounds.minZ),
            maxZ: round(bounds.maxZ),
            width: round(bounds.maxX - bounds.minX),
            height: round(bounds.maxY - bounds.minY),
            depth: round(bounds.maxZ - bounds.minZ),
        } : null,
        totalVolume: round(volume),
        byType,
        byMaterial,
        distinctColors: Object.keys(byColor).length,
        topColors: palette,
        nonColliding: noCollide,
        pureDecoration: decorative,
        unanchored,
        spawns: parts.filter((p) => p.T === 'SpawnLocation').length,
    };
}

export function density(parts, options = {}) {
    const field = surfaceField(parts, options);
    if (!field) return { tiles: [], cell: options.cell ?? 4 };

    const {
        cols, rows, cell, bounds,
    } = field;
    const window = Math.max(1, Math.round((options.window ?? 32) / cell));
    const counts = new Int32Array(cols * rows);
    const decor = parts.filter((p) => p.Cc === false || p.T !== 'SpawnLocation');

    for (const p of decor) {
        const b = partBounds(p);
        const c = Math.floor(((b.minX + b.maxX) / 2 - bounds.minX) / cell);
        const r = Math.floor(((b.minZ + b.maxZ) / 2 - bounds.minZ) / cell);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        counts[r * cols + c] += 1;
    }

    const tiles = [];
    for (let r = 0; r < rows; r += window) {
        for (let c = 0; c < cols; c += window) {
            let n = 0;
            let standable = 0;
            for (let dr = 0; dr < window && r + dr < rows; dr++) {
                for (let dc = 0; dc < window && c + dc < cols; dc++) {
                    const i = (r + dr) * cols + (c + dc);
                    n += counts[i];
                    if (field.cells[i].length) standable += 1;
                }
            }
            if (!standable) continue;
            tiles.push({
                region: {
                    x: round(bounds.minX + c * cell),
                    z: round(bounds.minZ + r * cell),
                    width: round(Math.min(window * cell, bounds.maxX - (bounds.minX + c * cell))),
                    depth: round(Math.min(window * cell, bounds.maxZ - (bounds.minZ + r * cell))),
                },
                parts: n,
                floorCells: standable,
                partsPerFloorCell: round(n / standable, 3),
            });
        }
    }

    return { cell, window: window * cell, tiles };
}

export function validate(doc, options = {}) {
    const { parts, groups, lights } = doc;
    const issues = [];
    const add = (severity, code, message, extra = {}) => issues
        .push({ severity, code, message, ...extra });

    if (!parts.length) {
        add('error', 'empty', 'the map has no parts at all');

        return { ok: false, issues, checked: 0 };
    }

    if (parts.length > LIMITS.maxParts) {
        add('error', 'part_limit', `${parts.length} parts is over the ${LIMITS.maxParts} the server accepts`);
    }

    const spawns = parts.filter((p) => p.T === 'SpawnLocation');
    if (!spawns.length) {
        add('error', 'no_spawn', 'there is no SpawnLocation, so Play has nowhere to put the character');
    }

    const bounds = boundsOf(parts);
    if (bounds.minY < PLAY.voidY) {
        add('error', 'below_void', `geometry reaches y=${round(bounds.minY)}, below the void plane at ${PLAY.voidY}`);
    }

    for (const p of parts) {
        if (p.S.some((v) => v <= 0)) {
            add('error', 'zero_size', `part ${p._id} has a zero or negative size`, { id: p._id });
        }
    }

    const overlapping = findOverlaps(parts, { tolerance: options.tolerance ?? 0.05, limit: 50 });
    const bad = overlapping.filter((o) => o.fractionOfSmaller > 0.5);
    if (bad.length) {
        add('warning', 'overlaps', `${bad.length} pairs of parts overlap by more than half their volume`, {
            examples: bad.slice(0, 8),
        });
    }

    const floating = findUnsupported(parts, { limit: 40 });
    if (floating.length) {
        add('warning', 'floating', `${floating.length} anchored parts hang in the air with nothing under them`, {
            examples: floating.slice(0, 8),
        });
    }

    let walk = null;
    if (options.walkability !== false) {
        try {
            walk = walkability(parts, { cell: options.cell ?? 4 });
            if (walk.unreachable.length) {
                const cells = walk.unreachable.reduce((n, i) => n + i.cells, 0);
                add('warning', 'unreachable', `${walk.unreachable.length} walkable areas cannot be reached from the spawn`, {
                    examples: walk.unreachable.slice(0, 6),
                    unreachableCells: cells,
                });
            }
            for (const spawn of spawns) {
                const b = partBounds(spawn);
                const blocked = parts.some((p) => p._id !== spawn._id && p.Cc !== false
                    && overlaps(partBounds(p), {
                        minX: b.minX + 0.5,
                        maxX: b.maxX - 0.5,
                        minY: b.maxY + 0.1,
                        maxY: b.maxY + PLAY.bodyHeight,
                        minZ: b.minZ + 0.5,
                        maxZ: b.maxZ - 0.5,
                    }));
                if (blocked) {
                    add('error', 'spawn_blocked', `the spawn at ${spawn.P.map((v) => round(v)).join(', ')} has something solid in the space the character needs`, { id: spawn._id });
                }
            }
        } catch (e) {
            add('info', 'walkability_skipped', e.message);
        }
    }

    const known = new Set(parts.map((p) => p._id));
    for (const g of groups) {
        const dead = g.ids.filter((id) => !known.has(id));
        if (dead.length) {
            add('warning', 'stale_group', `folder "${g.name}" refers to ${dead.length} parts that no longer exist`);
        }
    }

    if (lights.length > LIMITS.maxLights) {
        add('error', 'light_limit', `${lights.length} lights is over the ${LIMITS.maxLights} limit`);
    }
    if (!lights.length) {
        add('info', 'no_lights', 'the map has no lights; it will render with the default sun only');
    }

    return {
        ok: !issues.some((i) => i.severity === 'error'),
        issues,
        checked: parts.length,
        walkability: walk ? {
            cell: walk.cell,
            standableCells: walk.standableCells,
            reachableCells: walk.reachableCells,
            islands: walk.islands.length,
        } : null,
    };
}
