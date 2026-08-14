import { z } from 'zod';

import { MapDoc, MapError, newId } from './doc.js';
import { LiveSession, joinHello } from './session.js';
import { Studio, StudioError } from './studio.js';
import {
    DEFAULT_POINT_LIGHT, DEFAULT_SPOT_LIGHT, FIELD_INFO, LIMITS, MATERIALS, MATERIAL_INFO,
    MAX_JUMP_HEIGHT, PALETTES, PART_TYPES, PART_TYPE_INFO, PLAY, PROPS, PROP_IDS, TEXTURES,
    buildProp, propSummary,
} from './catalog.js';
import {
    buildCorridor, buildRoof, buildRoom, buildStairs, buildTerrain, carveAll, carvePlan, junctionBoxes,
    routeLegs, scatterProps, trimLegs,
} from './build.js';
import {
    density, findOverlaps, findUnsupported, statistics, validate, walkability,
} from './analyze.js';
import {
    boundsOf, boxOfRegion, partBounds, partsInRegion, regionBounds, round, roundVec,
} from './geom.js';
import { renderMap, VIEWS } from './render.js';
import {
    FACES as LIGHT_FACES, validPointLight, validSpotLight,
} from '../../live-editing-server/src/lights.js';

const hexColor = z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'a 6 digit hex colour such as 8a5a2b');
const material = z.enum(MATERIALS);
const paletteName = z.enum(Object.keys(PALETTES));
const vector3 = z.array(z.number()).length(3);

const region3 = {
    x: z.number().describe('minimum X corner of the region'),
    y: z.number().describe('minimum Y (floor level) of the region'),
    z: z.number().describe('minimum Z corner of the region'),
    width: z.number().positive().describe('size along X'),
    height: z.number().positive().describe('size along Y'),
    depth: z.number().positive().describe('size along Z'),
};

const footprint = {
    x: z.number().describe('minimum X corner'),
    z: z.number().describe('minimum Z corner'),
    width: z.number().positive().describe('size along X'),
    depth: z.number().positive().describe('size along Z'),
    y: z.number().default(0).describe('floor level; the walkable surface sits at this Y'),
};

const surfaceStyle = {
    palette: paletteName.optional()
        .describe('a coherent material and colour set. Prefer this over picking colours by hand'),
    floor: z.object({ material: material.optional(), color: hexColor.optional() }).optional(),
    wall: z.object({ material: material.optional(), color: hexColor.optional() }).optional(),
    ceiling: z.object({ material: material.optional(), color: hexColor.optional() }).optional(),
};

const ok = (payload) => ({
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
});

const fail = (message, hint) => ({
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: message, hint }, null, 2) }],
});

const partSummary = (p) => ({
    id: p._id,
    type: p.T,
    position: roundVec(p.P),
    size: roundVec(p.S),
    rotation: roundVec(p.R),
    color: p.C ?? 'a3a2a5',
    material: p.M ?? 'Plastic',
    ...(p.Tr ? { transparency: p.Tr } : {}),
    ...(p.Cc === false ? { collides: false } : {}),
    ...(p.An === false ? { anchored: false } : {}),
    ...(p.Bp ? { baseplate: true } : {}),
});

export class Context {
    constructor(config) {
        this.config = config;
        this.studio = new Studio({ baseUrl: config.studioUrl });
        this.doc = new MapDoc({});
        this.session = null;
        this.mapName = null;
        this.teamId = null;
        this.projectId = null;
        this.version = null;
        this.notes = [];
    }

    get live() {
        return this.session?.connected ? this.session : null;
    }

    async ensureSignedIn() {
        if (this.studio.signedIn) return this.studio.account;
        const { email, password } = this.config;
        if (!email || !password) {
            throw new StudioError(
                'no Studio credentials. Set STUDIO_EMAIL and STUDIO_PASSWORD in the MCP server '
                + 'environment so the agent can sign in as you.',
            );
        }

        return this.studio.login(email, password);
    }

    async findMap(name) {
        const list = await this.studio.listMaps();

        return (list.mine ?? []).find((m) => m.name === name) ?? null;
    }
}

function guardEditable(ctx) {
    if (ctx.live && !ctx.live.canEdit) {
        throw new MapError(
            'the live session made this connection a spectator, so the server will refuse edits. '
            + 'Ask the room owner to make you a developer.',
        );
    }
}

function describeResult(ctx, result) {
    return {
        ...result,
        mode: ctx.live ? 'live' : 'offline',
        liveRoom: ctx.live?.code ?? null,
        totalParts: ctx.doc.parts.length,
        canUndo: ctx.doc.historyLabels.length,
    };
}

export function register(server, ctx) {
    const tool = (name, description, shape, handler) => {
        server.registerTool(name, { description, inputSchema: shape }, async (args) => {
            try {
                return await handler(args ?? {});
            } catch (e) {
                if (e instanceof MapError || e instanceof StudioError) return fail(e.message);
                if (e?.name === 'LiveError') return fail(e.message);

                return fail(e?.message ?? String(e));
            }
        });
    };

    const edit = (name, description, shape, handler) => tool(name, description, shape, async (args) => {
        guardEditable(ctx);

        return handler(args);
    });

    tool(
        'get_session',
        'Who the agent is signed in as, whether it is attached to a live editing room, and which '
        + 'map is loaded. Call this first when you are unsure what you are editing.',
        {},
        async () => ok({
            studioUrl: ctx.config.studioUrl,
            liveUrl: ctx.config.liveUrl,
            account: ctx.studio.account,
            mode: ctx.live ? 'live' : 'offline',
            room: ctx.live?.code ?? null,
            mapName: ctx.mapName ?? ctx.live?.mapName ?? null,
            teamId: ctx.teamId,
            editingAs: ctx.live?.you?.name ?? null,
            role: ctx.live?.you?.role ?? null,
            canEdit: ctx.live ? ctx.live.canEdit : true,
            members: (ctx.live?.members ?? []).map((m) => ({ name: m.name, role: m.role })),
            parts: ctx.doc.parts.length,
        }),
    );

    tool(
        'connect_live',
        'Join a live editing session by its room code so every change shows up in the browser '
        + 'immediately, attributed to you with a "(MCP)" suffix. Get the code from the Live button '
        + 'in the Studio. Without this the agent still works, but only on an offline copy.',
        {
            room: z.string().min(4).max(12).describe('the room code shown in the Studio, e.g. "K3F9QB"'),
        },
        async ({ room }) => {
            await ctx.ensureSignedIn();
            const code = room.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

            const probe = new LiveSession({ url: ctx.config.liveUrl, origin: ctx.config.origin });
            const seen = await probe.open(joinHello(code, null));
            const mapName = probe.mapName;
            probe.leave();

            const entry = await ctx.findMap(mapName);
            const token = await ctx.studio.liveToken(mapName, entry?.team_id ?? null, true);

            const session = new LiveSession({ url: ctx.config.liveUrl, origin: ctx.config.origin });
            session.bind(ctx.doc);
            const joined = await session.open(joinHello(code, token));

            ctx.session = session;
            ctx.mapName = mapName;
            ctx.teamId = entry?.team_id ?? null;

            return ok({
                room: joined.code,
                mapName,
                editingAs: joined.you.name,
                role: joined.you.role,
                canEdit: session.canEdit,
                parts: ctx.doc.parts.length,
                members: joined.members.map((m) => ({ name: m.name, role: m.role })),
                seenBefore: seen.parts,
                note: session.canEdit
                    ? 'Edits now stream to everyone in the room in real time.'
                    : 'Joined as a spectator: the server will refuse edits until the owner promotes you.',
            });
        },
    );

    tool(
        'disconnect_live',
        'Leave the live editing room. The map stays loaded offline, so you can keep working and '
        + 'save it with save_map.',
        {},
        async () => {
            if (!ctx.session) return ok({ mode: 'offline', note: 'was not connected' });
            ctx.session.leave();
            ctx.session = null;

            return ok({ mode: 'offline', parts: ctx.doc.parts.length });
        },
    );

    tool(
        'list_maps',
        'List the maps this account can open, personal and team, with their part counts and which '
        + 'team they belong to.',
        {},
        async () => {
            await ctx.ensureSignedIn();
            const data = await ctx.studio.listMaps();

            return ok({
                maps: (data.mine ?? []).map((m) => ({
                    name: m.name,
                    teamId: m.team_id,
                    version: m.version,
                    modified: new Date(m.modified * 1000).toISOString(),
                })),
                teams: data.teams ?? [],
            });
        },
    );

    tool(
        'load_map',
        'Load a saved map from the Studio into the agent working copy. Use this for offline work; '
        + 'if you want the user to watch you build, use connect_live instead.',
        {
            name: z.string().describe('the map name as shown on the start screen'),
            team: z.number().int().nullable().optional().describe('team id if it is a team map'),
        },
        async ({ name, team = null }) => {
            await ctx.ensureSignedIn();
            const data = await ctx.studio.loadMap(name, team ?? null);
            ctx.doc.reset({
                parts: data.parts ?? [],
                groups: data.groups ?? [],
                lighting: data.lighting ?? data.lights ?? null,
            });
            ctx.mapName = name;
            ctx.teamId = team ?? null;
            ctx.projectId = data.project_id ?? null;
            ctx.version = data.version ?? null;

            return ok({
                name,
                parts: ctx.doc.parts.length,
                groups: ctx.doc.groups.length,
                lighting: ctx.doc.lighting,
                mode: 'offline',
            });
        },
    );

    tool(
        'save_map',
        'Write the working copy back to the Studio. In a live session the room already has every '
        + 'change, so this is about persisting it. Saving a map down to a fraction of its old size '
        + 'needs confirm: true.',
        {
            name: z.string().optional().describe('defaults to the map currently loaded or joined'),
            team: z.number().int().nullable().optional(),
            confirm: z.boolean().default(false)
                .describe('set true to accept a save that removes most of the map'),
        },
        async ({ name, team, confirm }) => {
            await ctx.ensureSignedIn();
            const target = name ?? ctx.mapName;
            if (!target) throw new MapError('no map name: pass one, or load_map / connect_live first');

            const result = await ctx.studio.saveMap(target, {
                parts: ctx.doc.parts,
                groups: ctx.doc.groups,
                lighting: ctx.doc.lighting,
                projectId: ctx.projectId,
                teamId: team ?? ctx.teamId,
                version: ctx.version,
                confirm,
            });
            if (result.error === 'destructive') {
                return fail(
                    `that save would cut the map from ${result.was} parts to ${result.now}`,
                    'call save_map again with confirm: true if that is really what you want',
                );
            }
            ctx.version = result.version ?? ctx.version;
            ctx.live?.send({ t: 'saved' });

            return ok({ saved: target, version: ctx.version, parts: ctx.doc.parts.length });
        },
    );

    tool(
        'get_map_info',
        'A high level picture of the map: size, bounds, part and folder counts, spawn points and '
        + 'lights. Start here before planning any change.',
        {},
        async () => {
            const stats = statistics(ctx.doc.parts, ctx.doc.groups, ctx.doc.lighting);

            return ok(describeResult(ctx, {
                mapName: ctx.mapName,
                ...stats,
                folders: ctx.doc.groups.map((g) => ({
                    id: g.id, name: g.name, parts: g.ids.length, ...(g.parent ? { parent: g.parent } : {}),
                })),
                lighting: ctx.doc.lighting,
            }));
        },
    );

    tool(
        'get_map_constraints',
        'The hard limits and the character movement numbers that decide whether a map is playable: '
        + 'how tall the character is, how high it can step and jump, and the server part limits. '
        + 'Read this before choosing room heights, doorway sizes or step heights.',
        {},
        async () => ok({
            limits: LIMITS,
            character: {
                ...PLAY,
                maxJumpHeight: round(MAX_JUMP_HEIGHT, 2),
                width: PLAY.halfWidth * 2,
            },
            guidance: {
                minimumCeiling: PLAY.bodyHeight + 2,
                comfortableCeiling: 14,
                minimumDoorway: { width: 6, height: PLAY.bodyHeight + 1 },
                comfortableCorridorWidth: 8,
                maximumStepWithoutJumping: PLAY.stepHeight,
                maximumClimbWithJump: round(MAX_JUMP_HEIGHT, 2),
                axes: 'X and Z are the ground plane, Y is up. Sizes are full sizes, positions are centres.',
            },
        }),
    );

    tool(
        'get_available_assets',
        'Everything you can build with: the editor materials and part types, the prop prefabs this '
        + 'server can place, and the palettes that keep a map visually coherent. Each prop says what '
        + 'it is for, whether it blocks movement and which settings it suits.',
        {
            category: z.string().optional()
                .describe('filter props by category, e.g. lighting, furniture, decoration, structure'),
            terrain: z.string().optional()
                .describe('filter props by setting, e.g. dungeon, cave, outdoor, prison'),
        },
        async ({ category, terrain }) => {
            let ids = PROP_IDS;
            if (category) ids = ids.filter((id) => PROPS[id].category === category);
            if (terrain) ids = ids.filter((id) => PROPS[id].terrain?.includes(terrain));

            return ok({
                materials: Object.fromEntries(MATERIALS.map((m) => [m, MATERIAL_INFO[m]])),
                partTypes: Object.fromEntries(PART_TYPES.map((t) => [t, PART_TYPE_INFO[t]])),
                faceTextures: {
                    values: TEXTURES,
                    note: 'applied per face via Tx, e.g. { "Top": "Studs" }',
                },
                palettes: Object.fromEntries(
                    Object.entries(PALETTES).map(([k, v]) => [k, v.description]),
                ),
                props: ids.map(propSummary),
                partFields: FIELD_INFO,
            });
        },
    );

    tool(
        'get_map_region',
        'List the parts inside a box of the map. Use this to look closely at one room instead of '
        + 'pulling the whole map, and to get the ids you need for precise edits.',
        {
            ...footprint,
            height: z.number().positive().default(200).describe('how far up from y to look'),
            contained: z.boolean().default(false)
                .describe('true returns only parts fully inside the box, false includes anything touching it'),
            limit: z.number().int().min(1).max(500).default(120),
        },
        async ({
            x, y, z, width, depth, height, contained, limit,
        }) => {
            const region = {
                x, y, z, width, height, depth,
            };
            const hit = partsInRegion(ctx.doc.parts, region, contained ? 'contain' : 'overlap');
            const bounds = boundsOf(hit);

            return ok({
                region,
                found: hit.length,
                returned: Math.min(hit.length, limit),
                bounds: bounds ? {
                    minX: round(bounds.minX),
                    maxX: round(bounds.maxX),
                    minY: round(bounds.minY),
                    maxY: round(bounds.maxY),
                    minZ: round(bounds.minZ),
                    maxZ: round(bounds.maxZ),
                } : null,
                parts: hit.slice(0, limit).map(partSummary),
            });
        },
    );

    tool(
        'get_structure',
        'The organised view of the map: every folder with its bounds and contents, every spawn '
        + 'point and every light. Folders are how rooms and areas are named, so this is the map '
        + 'outline you should reason about when connecting or editing areas.',
        {},
        async () => {
            const byId = new Map(ctx.doc.parts.map((p) => [p._id, p]));

            return ok({
                folders: ctx.doc.groups.map((g) => {
                    const parts = g.ids.map((id) => byId.get(id)).filter(Boolean);
                    const b = boundsOf(parts);

                    return {
                        id: g.id,
                        name: g.name,
                        parts: parts.length,
                        ...(g.parent ? { parent: g.parent } : {}),
                        bounds: b ? {
                            minX: round(b.minX),
                            maxX: round(b.maxX),
                            minY: round(b.minY),
                            maxY: round(b.maxY),
                            minZ: round(b.minZ),
                            maxZ: round(b.maxZ),
                        } : null,
                        centre: b ? [
                            round((b.minX + b.maxX) / 2),
                            round((b.minY + b.maxY) / 2),
                            round((b.minZ + b.maxZ) / 2),
                        ] : null,
                    };
                }),
                spawns: ctx.doc.parts.filter((p) => p.T === 'SpawnLocation').map(partSummary),
                lighting: ctx.doc.lighting,
                ungrouped: ctx.doc.parts.length
                    - ctx.doc.groups.reduce((n, g) => n + g.ids.length, 0),
            });
        },
    );

    tool(
        'find_parts',
        'Search the map for parts by type, material, colour, folder or position. Use it to get ids '
        + 'for precise edits, or to check how much of something you already placed.',
        {
            type: z.enum(PART_TYPES).optional(),
            material: material.optional(),
            color: hexColor.optional(),
            folder: z.string().optional().describe('folder name or id'),
            near: vector3.optional().describe('centre of a sphere to search in'),
            radius: z.number().positive().default(40),
            limit: z.number().int().min(1).max(500).default(100),
        },
        async ({
            type, material: mat, color, folder, near, radius, limit,
        }) => {
            let hit = ctx.doc.parts;
            if (type) hit = hit.filter((p) => p.T === type);
            if (mat) hit = hit.filter((p) => (p.M ?? 'Plastic') === mat);
            if (color) {
                const want = color.replace(/^#/, '').toLowerCase();
                hit = hit.filter((p) => (p.C ?? 'a3a2a5').toLowerCase() === want);
            }
            if (folder) {
                const g = ctx.doc.groups.find((x) => x.id === folder || x.name === folder);
                if (!g) throw new MapError(`no folder called "${folder}"`);
                const ids = new Set(g.ids);
                hit = hit.filter((p) => ids.has(p._id));
            }
            if (near) {
                hit = hit.filter((p) => Math.hypot(
                    p.P[0] - near[0], p.P[1] - near[1], p.P[2] - near[2],
                ) <= radius);
            }

            return ok({
                found: hit.length,
                returned: Math.min(hit.length, limit),
                parts: hit.slice(0, limit).map(partSummary),
            });
        },
    );

    edit(
        'create_room',
        'Build a complete room in one atomic action: floor, four walls, optional ceiling, with '
        + 'doorway openings left in the walls where you ask for them. The room is put in its own '
        + 'named folder so you can find and connect it later. This is the main building block for '
        + 'an interior map.',
        {
            name: z.string().describe('what this room is, e.g. "Entrance Hall". Becomes the folder name'),
            ...footprint,
            height: z.number().positive().default(14)
                .describe('inside wall height. Must clear the character; see get_map_constraints'),
            wallThickness: z.number().positive().default(2),
            floorThickness: z.number().positive().default(2),
            floor: z.union([z.literal(false), z.object({
                material: material.optional(), color: hexColor.optional(),
            })]).optional().describe('false to leave the floor out'),
            ceiling: z.union([z.boolean(), z.object({
                material: material.optional(), color: hexColor.optional(),
            })]).optional().describe('true or a style object to roof the room'),
            palette: paletteName.optional(),
            wall: surfaceStyle.wall,
            studs: z.boolean().default(true).describe('stud texture on the floor top'),
            doorways: z.array(z.object({
                side: z.enum(['north', 'south', 'east', 'west'])
                    .describe('north is minimum Z, south is maximum Z, west is minimum X, east is maximum X'),
                offset: z.number().optional()
                    .describe('centre of the opening along that wall in world units; defaults to the middle'),
                width: z.number().positive().default(8),
                height: z.number().positive().default(12),
            })).default([]).describe('openings left in the walls so the room can be entered'),
            roof: z.object({
                pitch: z.number().min(5).max(70).default(34),
                overhang: z.number().min(0).default(1),
                thickness: z.number().positive().default(1),
                ridge: z.enum(['x', 'z']).optional(),
                color: hexColor.optional(),
                material: material.optional(),
            }).optional().describe(
                'cap the room with a pitched roof sitting on the walls, in the same action. Use it '
                + 'for a building seen from outside; ceiling is the flat indoor version',
            ),
        },
        async (args) => {
            const clash = !!ctx.doc.findGroup(args.name);
            const parts = buildRoom(args);
            const roof = args.roof
                ? buildRoof({
                    ...args.roof,
                    x: args.x,
                    z: args.z,
                    width: args.width,
                    depth: args.depth,
                    y: args.y + args.height,
                    palette: args.palette,
                    wall: args.wall,
                    gableThickness: args.wallThickness,
                })
                : null;
            if (roof) parts.push(...roof.parts);
            const result = ctx.doc.addParts(`create room ${args.name}`, parts, { groupName: args.name });
            const b = boundsOf(parts);

            return ok(describeResult(ctx, {
                room: args.name,
                folderId: result.groupId,
                ...(clash ? {
                    note: `there was already a folder called "${args.name}", so the map now has two. `
                        + 'Rename one with rename_folder, or add later parts to a room with '
                        + 'place_parts folder / group_parts rather than creating it again',
                } : {}),
                partsAdded: result.added,
                inside: {
                    minX: round(args.x + args.wallThickness),
                    maxX: round(args.x + args.width - args.wallThickness),
                    minZ: round(args.z + args.wallThickness),
                    maxZ: round(args.z + args.depth - args.wallThickness),
                    floorY: args.y,
                    ceilingY: round(args.y + args.height),
                },
                bounds: {
                    minX: round(b.minX), maxX: round(b.maxX), minZ: round(b.minZ), maxZ: round(b.maxZ),
                },
                doorways: args.doorways.length,
                ...(roof ? {
                    roof: {
                        ridge: roof.ridge, pitch: roof.pitch, rise: roof.rise, ridgeY: roof.ridgeY,
                    },
                } : {}),
            }));
        },
    );

    edit(
        'create_corridor',
        'Build a walkable corridor between two points on the ground plane, with a floor and side '
        + 'walls. Corridors run along X and Z; give two points that differ on both axes and you get '
        + 'an L bend. Use connect_rooms instead if you want the openings cut for you.',
        {
            name: z.string().default('Corridor'),
            from: z.array(z.number()).length(2).describe('[x, z] start, on the centre line'),
            to: z.array(z.number()).length(2).describe('[x, z] end, on the centre line'),
            y: z.number().default(0).describe('floor level'),
            width: z.number().positive().default(8),
            height: z.number().positive().default(12),
            wallThickness: z.number().positive().default(2),
            walls: z.boolean().default(true),
            ceiling: z.boolean().default(false),
            bend: z.enum(['x', 'z']).default('x')
                .describe('x runs along X first then Z; z does the opposite'),
            palette: paletteName.optional(),
        },
        async (args) => {
            const parts = buildCorridor(args);
            const result = ctx.doc.addParts(`create corridor ${args.name}`, parts, { groupName: args.name });

            return ok(describeResult(ctx, {
                corridor: args.name,
                folderId: result.groupId,
                partsAdded: result.added,
                legs: routeLegs(args.from, args.to, args.bend).map((l) => ({
                    axis: l.axis, from: round(l.from), to: round(l.to), at: round(l.fixed),
                })),
            }));
        },
    );

    edit(
        'connect_rooms',
        'Join two existing rooms with a corridor AND cut the openings through whatever walls are in '
        + 'the way, so the result is genuinely walkable rather than a corridor butted against a wall. '
        + 'Give the folder names create_room used. This is the tool that makes a set of rooms into a level.',
        {
            from: z.string().describe('folder name or id of the first room'),
            to: z.string().describe('folder name or id of the second room'),
            width: z.number().positive().default(8).describe('corridor and opening width'),
            height: z.number().positive().default(12),
            openingHeight: z.number().positive().default(10)
                .describe('height of the hole cut through the walls'),
            wallThickness: z.number().positive().default(6)
                .describe('how deep the opening is cut; make it at least the wall thickness'),
            y: z.number().optional().describe('floor level; defaults to the first room floor'),
            bend: z.enum(['x', 'z']).default('x'),
            palette: paletteName.optional(),
            name: z.string().optional(),
        },
        async (args) => {
            const byId = new Map(ctx.doc.parts.map((p) => [p._id, p]));
            const pick = (key) => {
                const g = ctx.doc.groups.find((x) => x.id === key || x.name === key);
                if (!g) {
                    throw new MapError(
                        `no folder called "${key}". Call get_structure to see the rooms that exist.`,
                    );
                }
                const parts = g.ids.map((id) => byId.get(id)).filter(Boolean);
                const b = boundsOf(parts);
                if (!b) throw new MapError(`folder "${key}" has no parts left`);

                return { group: g, bounds: b };
            };

            const a = pick(args.from);
            const b = pick(args.to);
            const ac = [(a.bounds.minX + a.bounds.maxX) / 2, (a.bounds.minZ + a.bounds.maxZ) / 2];
            const bc = [(b.bounds.minX + b.bounds.maxX) / 2, (b.bounds.minZ + b.bounds.maxZ) / 2];
            const y = args.y ?? round(a.bounds.minY + 2);

            const legs = trimLegs(routeLegs(ac, bc, args.bend), a.bounds, b.bounds);
            if (!legs.length) {
                throw new MapError(
                    `"${a.group.name}" and "${b.group.name}" already touch, so there is no room for a corridor `
                    + 'between them. Use carve_opening to put a doorway through the shared wall instead.',
                );
            }

            const corridor = buildCorridor({
                legs,
                y,
                width: args.width,
                height: args.height,
                palette: args.palette,
            });

            const carveRegions = junctionBoxes(legs, {
                width: args.width,
                height: args.openingHeight,
                y,
                margin: args.wallThickness ?? 6,
            });

            const name = args.name ?? `${a.group.name} to ${b.group.name}`;
            const plan = carveAll(ctx.doc.parts, carveRegions);
            if (plan.removed.length) {
                ctx.doc.replaceParts(
                    `open walls between ${a.group.name} and ${b.group.name}`,
                    plan.removed,
                    plan.added,
                );
            }

            const added = ctx.doc.addParts(`corridor ${name}`, corridor, { groupName: name });

            return ok(describeResult(ctx, {
                connected: [a.group.name, b.group.name],
                corridorFolder: added.groupId,
                corridorParts: added.added,
                wallsCut: plan.removed.length,
                rotatedPartsSkipped: plan.skipped.length,
                note: plan.skipped.length
                    ? 'some rotated parts could not be cut and were left alone; check the opening visually'
                    : undefined,
            }));
        },
    );

    edit(
        'carve_opening',
        'Cut a hole through existing geometry: a doorway, a window, an arch or a shaft. Parts that '
        + 'the box crosses are split into the pieces around it, so walls stay solid everywhere else. '
        + 'Rotated parts cannot be split and are reported back untouched.',
        {
            ...region3,
            reason: z.string().optional().describe('what the opening is for, used as the undo label'),
        },
        async ({
            x, y, z, width, height, depth, reason,
        }) => {
            const region = {
                x, y, z, width, height, depth,
            };
            const plan = carvePlan(ctx.doc.parts, region);
            if (!plan.removed.length) {
                return ok(describeResult(ctx, {
                    carved: 0,
                    note: 'nothing solid crossed that box, so nothing changed',
                    skipped: plan.skipped.length,
                }));
            }

            const result = ctx.doc.replaceParts(reason ?? 'carve opening', plan.removed, plan.added);

            return ok(describeResult(ctx, {
                carved: plan.removed.length,
                piecesLeft: result.added,
                skippedRotated: plan.skipped,
            }));
        },
    );

    edit(
        'create_stairs',
        'Build a flight of steps between two heights. The rise per step is checked against what the '
        + 'character can actually walk up, so the result is always climbable.',
        {
            name: z.string().default('Stairs'),
            from: vector3.describe('[x, y, z] at the bottom, on the centre line'),
            to: vector3.describe('[x, y, z] at the top, on the centre line'),
            width: z.number().positive().default(8),
            steps: z.number().int().positive().optional().describe('defaults to a comfortable count'),
            palette: paletteName.optional(),
        },
        async (args) => {
            const parts = buildStairs(args);
            const result = ctx.doc.addParts(`create stairs ${args.name}`, parts, { groupName: args.name });

            return ok(describeResult(ctx, {
                stairs: args.name,
                folderId: result.groupId,
                steps: result.added,
                risePerStep: round((args.to[1] - args.from[1]) / result.added, 3),
            }));
        },
    );

    edit(
        'fill_region',
        'Fill a box with a single solid part. Use it for platforms, plinths, pillars of water or '
        + 'ice, ceilings, or the ground slab under a map.',
        {
            ...region3,
            name: z.string().default('Fill'),
            material: material.default('Plastic'),
            color: hexColor.default('7d7a74'),
            transparency: z.number().min(0).max(1).default(0),
            collides: z.boolean().default(true),
            baseplate: z.boolean().default(false).describe('mark as the map ground slab'),
            studs: z.boolean().default(false).describe('stud texture on the top face'),
        },
        async ({
            x, y, z, width, height, depth, name, material: mat, color, transparency, collides,
            baseplate, studs,
        }) => {
            const part = boxOfRegion({
                x, y, z, width, height, depth,
            }, {
                M: mat,
                C: color.replace(/^#/, '').toLowerCase(),
                Tr: transparency,
                ...(collides ? {} : { Cc: false }),
                ...(baseplate ? { Bp: true } : {}),
                ...(studs ? { Tx: { Top: 'Studs' } } : {}),
            });
            const result = ctx.doc.addParts(`fill ${name}`, [part]);

            return ok(describeResult(ctx, { filled: name, id: result.ids[0], partsAdded: 1 }));
        },
    );

    edit(
        'paint_region',
        'Restyle the parts already inside a box without moving anything: change material, colour or '
        + 'transparency. Use it to add variation to a flat looking area, or to fix a colour clash '
        + 'you noticed in a preview.',
        {
            ...footprint,
            height: z.number().positive().default(200),
            material: material.optional(),
            color: hexColor.optional(),
            transparency: z.number().min(0).max(1).optional(),
            onlyMaterial: material.optional().describe('restrict to parts already using this material'),
            onlyColor: hexColor.optional().describe('restrict to parts already using this colour'),
            everyNth: z.number().int().min(1).default(1)
                .describe('paint only every Nth matching part, for a scattered mix rather than a solid block'),
        },
        async ({
            x, y, z, width, depth, height, material: mat, color, transparency,
            onlyMaterial, onlyColor, everyNth,
        }) => {
            if (!mat && !color && transparency === undefined) {
                throw new MapError('give at least one of material, color or transparency');
            }
            const region = {
                x, y, z, width, height, depth,
            };
            let hit = partsInRegion(ctx.doc.parts, region);
            if (onlyMaterial) hit = hit.filter((p) => (p.M ?? 'Plastic') === onlyMaterial);
            if (onlyColor) {
                const want = onlyColor.replace(/^#/, '').toLowerCase();
                hit = hit.filter((p) => (p.C ?? 'a3a2a5').toLowerCase() === want);
            }
            hit = hit.filter((_, i) => i % everyNth === 0);
            if (!hit.length) throw new MapError('no parts in that box matched');

            const fields = {};
            if (mat) fields.M = mat;
            if (color) fields.C = color.replace(/^#/, '').toLowerCase();
            if (transparency !== undefined) fields.Tr = transparency;

            const result = ctx.doc.setFields('paint region', hit.map((p) => ({ id: p._id, fields })));

            return ok(describeResult(ctx, { painted: result.changed, fields }));
        },
    );

    edit(
        'place_prop',
        'Place one prop prefab at an exact spot, standing on the given floor level. Use this when '
        + 'position matters: a chest at the end of a hall, a brazier beside a door. For filling an '
        + 'area with clutter use scatter_props.',
        {
            prop: z.enum(PROP_IDS).describe('call get_available_assets to see what each one is for'),
            x: z.number(),
            y: z.number().describe('the floor level the prop stands on, not its centre'),
            z: z.number(),
            yaw: z.number().default(0).describe('rotation about Y in degrees'),
            scale: z.number().positive().default(1),
            color: hexColor.optional().describe('overrides the prop main colour'),
            material: material.optional(),
            height: z.number().positive().optional().describe('for props that accept one, e.g. pillar, banner'),
            width: z.number().positive().optional(),
            variant: z.string().optional(),
            folder: z.string().optional()
                .describe('folder to file it under, by name or id; an existing one is extended'),
        },
        async (args) => {
            const parts = buildProp(args.prop, args);
            const result = ctx.doc.addParts(
                `place ${args.prop}`,
                parts,
                args.folder ? { groupName: args.folder, appendToExisting: true } : {},
            );

            return ok(describeResult(ctx, {
                prop: args.prop,
                at: [args.x, args.y, args.z],
                partsAdded: result.added,
                ids: result.ids,
                ...(args.folder ? { folder: result.groupName, folderId: result.groupId } : {}),
            }));
        },
    );

    edit(
        'scatter_props',
        'Sprinkle props across an area without overlapping each other or the geometry already '
        + 'there. This is how you decorate a room quickly and get a natural looking result: give it '
        + 'a few prop types and a count, and it finds spots that fit.',
        {
            ...footprint,
            height: z.number().positive().default(20),
            props: z.array(z.enum(PROP_IDS)).min(1)
                .describe('the prop types to draw from, mixed randomly'),
            count: z.number().int().min(1).max(200).default(10),
            seed: z.number().int().default(1).describe('same seed gives the same layout'),
            spacing: z.number().min(0).default(2).describe('minimum clear gap between props'),
            avoidOverlap: z.boolean().default(true),
            randomYaw: z.boolean().default(true),
            folder: z.string().optional(),
            color: hexColor.optional(),
            material: material.optional(),
        },
        async (args) => {
            const region = {
                x: args.x, y: args.y, z: args.z, width: args.width, height: args.height, depth: args.depth,
            };
            const outcome = scatterProps({ ...args, region }, ctx.doc.parts);
            if (!outcome.placed.length) {
                return ok(describeResult(ctx, {
                    placed: 0,
                    note: 'no room for any of those props in that area; try a bigger area, smaller spacing or fewer props',
                }));
            }

            const parts = outcome.placed.flatMap((p) => p.parts);
            const result = ctx.doc.addParts(
                `scatter ${args.count} props`,
                parts,
                { groupName: args.folder ?? 'Decoration', appendToExisting: true },
            );

            return ok(describeResult(ctx, {
                requested: args.count,
                placed: outcome.placed.length,
                partsAdded: result.added,
                folderId: result.groupId,
                positions: outcome.placed.map((p) => ({ prop: p.prop, at: p.at, yaw: p.yaw })),
                note: outcome.placed.length < args.count
                    ? 'the area filled up before reaching the requested count'
                    : undefined,
            }));
        },
    );

    edit(
        'generate_terrain',
        'Lay down an uneven blocky landscape over an area, built from one column per cell. Use it '
        + 'for outdoor ground, cave floors and anything that should not read as a flat slab.',
        {
            ...footprint,
            name: z.string().default('Terrain'),
            cell: z.number().positive().default(8).describe('column footprint; smaller means finer and more parts'),
            amplitude: z.number().default(8).describe('how far the surface moves up and down'),
            roughness: z.number().min(0).max(1).default(0.5)
                .describe('0 is smooth rolling, 1 is noisy and broken'),
            thickness: z.number().positive().default(6),
            seed: z.number().int().default(1),
            palette: paletteName.optional(),
            floor: z.object({ material: material.optional(), color: hexColor.optional() }).optional(),
        },
        async (args) => {
            const parts = buildTerrain(args);
            const result = ctx.doc.addParts(`generate terrain ${args.name}`, parts, { groupName: args.name });

            return ok(describeResult(ctx, {
                terrain: args.name,
                columns: result.added,
                folderId: result.groupId,
            }));
        },
    );

    edit(
        'set_lighting',
        'Set the light the whole map sits in: an ambient fill with no direction, and one sun with a '
        + 'colour, an illuminance in lux and a rotation that says which way it comes from. Torches '
        + 'and braziers are props and only look like light sources, so pair a warm sun with them. '
        + 'To light one spot rather than the map, put a point or spot light on a part instead.',
        {
            ambient_color: hexColor.optional().describe('colour of the fill light'),
            brightness: z.number().min(0).max(LIMITS.maxBrightness).optional()
                .describe('how strong the fill is; 0 leaves the shadows black'),
            sun_color: hexColor.optional(),
            sun_illuminance: z.number().min(0).max(LIMITS.maxIlluminance).optional()
                .describe('lux; 10000 is daylight'),
            sun_shadow_maps_enabled: z.boolean().optional(),
            sun_rotation: vector3.optional()
                .describe('degrees, the direction the sun shines from, like a part rotation'),
        },
        async (args) => {
            const patch = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
            if (!Object.keys(patch).length) throw new MapError('give at least one thing to change');
            for (const k of ['ambient_color', 'sun_color']) {
                if (patch[k]) patch[k] = patch[k].replace(/^#/, '').toLowerCase();
            }
            ctx.doc.setLighting('set lighting', { ...ctx.doc.lighting, ...patch });

            return ok(describeResult(ctx, { lighting: ctx.doc.lighting }));
        },
    );

    edit(
        'attach_light',
        'Put a light on a part, or take it off. A point light throws light in every direction from '
        + 'the middle of the part; a spot light throws a cone out of one of its faces. The light '
        + 'belongs to the part, so moving or turning the part moves the light with it, and a part '
        + 'carries at most one of each. Use this for a lamp, a torch or a shaft of light through a '
        + 'window; use set_lighting for the light the whole map sits in.',
        {
            ids: z.array(z.string()).min(1).max(500).describe('the parts to light'),
            kind: z.enum(['point', 'spot']).describe('point throws light everywhere, spot throws a cone'),
            remove: z.boolean().default(false).describe('true takes that light off the parts instead'),
            color: hexColor.optional(),
            intensity: z.number().min(0).max(LIMITS.maxIntensity).optional()
                .describe('lumens; a room lamp is around 60000'),
            range: z.number().min(0).max(LIMITS.maxRange).optional()
                .describe('how far the light reaches, in world units'),
            shadow_maps_enabled: z.boolean().optional()
                .describe('shadows from a light on a part are expensive; leave them off unless it is the point'),
            angle: z.number().min(1).max(89).optional()
                .describe('spot only: half the cone, in degrees'),
            face: z.enum(LIGHT_FACES).optional()
                .describe('spot only: the face of the part the cone comes out of, e.g. Bottom for a ceiling lamp'),
        },
        async ({
            ids, kind, remove, ...fields
        }) => {
            const key = kind === 'spot' ? 'spot_light' : 'point_light';
            const parts = ids.map((id) => ctx.doc.require(id));

            if (remove) {
                const result = ctx.doc.setFields(
                    `remove ${kind} light`,
                    parts.map((p) => ({ id: p._id, unset: [key] })),
                );

                return ok(describeResult(ctx, { changed: result.changed, removed: key }));
            }

            const base = kind === 'spot' ? DEFAULT_SPOT_LIGHT : DEFAULT_POINT_LIGHT;
            const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
            if (kind !== 'spot' && (given.angle !== undefined || given.face !== undefined)) {
                throw new MapError('angle and face belong to a spot light; a point light has no cone');
            }
            const updates = parts.map((p) => {
                const light = { ...base, ...(p[key] ?? {}), ...given };
                if (light.color) light.color = light.color.replace(/^#/, '').toLowerCase();
                const ok2 = kind === 'spot' ? validSpotLight(light) : validPointLight(light);
                if (!ok2) throw new MapError(`that is not a usable ${kind} light: ${JSON.stringify(light)}`);

                return { id: p._id, fields: { [key]: light } };
            });
            const result = ctx.doc.setFields(`add ${kind} light`, updates);

            return ok(describeResult(ctx, {
                changed: result.changed, light: key, settings: updates[0].fields[key],
            }));
        },
    );

    edit(
        'place_parts',
        'The low level escape hatch: add explicit parts with exact positions, sizes and fields. Use '
        + 'it when no semantic tool fits, for example a custom shape, a sloped ramp using rotation, '
        + 'or a spawn point. Everything is validated the same way the editor validates it.',
        {
            parts: z.array(z.object({
                type: z.enum(PART_TYPES).default('Part'),
                position: vector3.describe('CENTRE of the part'),
                size: vector3.describe('full size, not half extents'),
                rotation: vector3.default([0, 0, 0]).describe(
                    'degrees, [rx, ry, rz], applied Y then X then Z, right handed. A positive rx '
                    + 'tips the +Z edge down, so a roof slab on the +Z side of the ridge uses a '
                    + 'positive rx and the -Z side the same angle negated. Slope angle for a run r '
                    + 'and a rise h is degrees(atan(h / r)), and the slab has to be r / cos(angle) long',
                ),
                color: hexColor.default('a3a2a5'),
                material: material.default('Plastic'),
                transparency: z.number().min(0).max(1).default(0),
                collides: z.boolean().default(true),
                anchored: z.boolean().default(true),
                castsShadow: z.boolean().default(true),
                textures: z.record(z.enum(TEXTURES)).optional()
                    .describe('per face, e.g. { "Top": "Studs" }'),
            })).min(1).max(500),
            folder: z.string().optional().describe(
                'folder to file these under, by name or id. An existing folder is extended, so '
                + 'repeated calls with the same name build up one folder instead of duplicates. '
                + 'Any other name creates a new folder',
            ),
            label: z.string().default('place parts').describe('shown in the undo history'),
        },
        async ({ parts, folder, label }) => {
            const built = parts.map((p) => ({
                T: p.type,
                P: p.position,
                S: p.size,
                R: p.rotation,
                C: p.color.replace(/^#/, '').toLowerCase(),
                M: p.material,
                Tr: p.transparency,
                ...(p.collides ? {} : { Cc: false }),
                ...(p.anchored ? {} : { An: false }),
                ...(p.castsShadow ? {} : { Cs: false }),
                ...(p.textures ? { Tx: p.textures } : {}),
            }));
            const result = ctx.doc.addParts(
                label,
                built,
                folder ? { groupName: folder, appendToExisting: true } : {},
            );

            return ok(describeResult(ctx, {
                added: result.added,
                ids: result.ids,
                ...(folder ? {
                    folder: result.groupName,
                    folderId: result.groupId,
                    appendedToFolder: result.appendedToFolder,
                } : {}),
            }));
        },
    );

    edit(
        'create_roof',
        'Put a pitched roof over a footprint: two sloped slabs meeting at a ridge, with the eaves '
        + 'overhanging and the triangular gable ends filled in. Reach for this instead of working '
        + 'out slab angles and lengths by hand with place_parts, and give it the footprint of the '
        + 'room it covers with y at the top of its walls. Pass the same palette or wall style the '
        + 'room was built with, because the gable ends are part of the wall and a mismatch shows.',
        {
            ...footprint,
            y: z.number().describe('height of the eaves, normally the top of the walls it sits on'),
            name: z.string().optional()
                .describe('folder to file the roof under; give the room name to keep it with the room'),
            pitch: z.number().min(5).max(70).default(34)
                .describe('slope in degrees; 34 is a house, 45 is steep, 15 is a shallow shed'),
            ridge: z.enum(['x', 'z']).optional()
                .describe('axis the ridge runs along; defaults to the longer side, so the roof slopes across the short one'),
            overhang: z.number().min(0).default(1).describe('how far the eaves stick out past the walls'),
            thickness: z.number().positive().default(1).describe('how thick the roof slabs are'),
            gables: z.boolean().default(true)
                .describe('fill the triangular ends; turn off for an open sided shelter'),
            gableThickness: z.number().positive().default(2)
                .describe('match the wall thickness of the room below'),
            palette: paletteName.optional(),
            color: hexColor.optional().describe('the roof colour; the gables follow the wall style'),
            material: material.optional(),
            wall: z.object({ material: material.optional(), color: hexColor.optional() }).optional()
                .describe('style for the gable ends'),
        },
        async (args) => {
            const built = buildRoof(args);
            const folder = args.name ?? null;
            const result = ctx.doc.addParts(
                `roof over ${round(args.width)}x${round(args.depth)}`,
                built.parts,
                folder ? { groupName: folder, appendToExisting: true } : {},
            );

            return ok(describeResult(ctx, {
                partsAdded: result.added,
                ids: result.ids,
                ridge: built.ridge,
                pitch: built.pitch,
                rise: built.rise,
                ridgeY: built.ridgeY,
                slabLength: built.slabLength,
                gables: args.gables ? 4 : 0,
                ...(folder ? { folder: result.groupName, folderId: result.groupId } : {}),
                note: `render view "${built.ridge === 'x' ? 'side' : 'front'}" to see the pitch; `
                    + 'the other flat view flattens it'
                    + (args.gables && !args.palette && !args.wall
                        ? '. The gable ends used the default wall style: if the room below has '
                        + 'another one, undo and pass its palette or wall colour'
                        : ''),
            }));
        },
    );

    edit(
        'group_parts',
        'File parts into a folder, by name or id. An existing folder gains the parts, a new name '
        + 'creates the folder, and a part only ever lives in one folder, so this is also how you '
        + 'move parts between them. Use it when something was built outside the folder it belongs '
        + 'to, instead of deleting and rebuilding it. Folders nest: pass parent to put this folder '
        + 'inside another one, which is how a building keeps its rooms together.',
        {
            folder: z.string().describe('folder name or id; an unknown name creates the folder'),
            ids: z.array(z.string()).min(1).max(500).describe('the parts to file under it'),
            replace: z.boolean().default(false)
                .describe('true drops whatever else was in the folder, leaving only these parts'),
            parent: z.string().nullable().optional()
                .describe('folder name or id to nest this folder inside; null moves it to the top level'),
        },
        async ({
            folder, ids, replace, parent,
        }) => ok(describeResult(
            ctx,
            ctx.doc.groupParts(`file ${ids.length} parts under ${folder}`, {
                folder, ids, replace, parent,
            }),
        )),
    );

    edit(
        'rename_folder',
        'Rename a folder without touching the parts in it. Two folders with the same name are legal '
        + 'but confusing, so use this to tell rebuilt or duplicated areas apart.',
        {
            folder: z.string().describe('folder name or id'),
            name: z.string().min(1).max(64).describe('the new name'),
        },
        async ({ folder, name }) => ok(describeResult(
            ctx,
            ctx.doc.renameGroup(`rename folder to ${name}`, folder, name),
        )),
    );

    edit(
        'delete_folder',
        'Remove a folder and leave its parts in the map, ungrouped. This deletes the grouping only; '
        + 'to remove the geometry as well use delete_parts.',
        {
            folder: z.string().describe('folder name or id'),
        },
        async ({ folder }) => ok(describeResult(
            ctx,
            ctx.doc.deleteGroup(`delete folder ${folder}`, folder),
        )),
    );

    edit(
        'modify_parts',
        'Change fields on parts you already found by id: colour, material, position, size, rotation '
        + 'or flags. This is the precise correction tool to reach for after looking at a preview.',
        {
            ids: z.array(z.string()).min(1).max(500),
            position: vector3.optional().describe('sets an absolute centre; usually you want move_parts'),
            size: vector3.optional(),
            rotation: vector3.optional(),
            color: hexColor.optional(),
            material: material.optional(),
            transparency: z.number().min(0).max(1).optional(),
            collides: z.boolean().optional(),
            anchored: z.boolean().optional(),
        },
        async ({ ids, ...rest }) => {
            const fields = {};
            if (rest.position) fields.P = rest.position;
            if (rest.size) fields.S = rest.size;
            if (rest.rotation) fields.R = rest.rotation;
            if (rest.color) fields.C = rest.color.replace(/^#/, '').toLowerCase();
            if (rest.material) fields.M = rest.material;
            if (rest.transparency !== undefined) fields.Tr = rest.transparency;
            if (rest.collides !== undefined) fields.Cc = rest.collides;
            if (rest.anchored !== undefined) fields.An = rest.anchored;
            if (!Object.keys(fields).length) throw new MapError('give at least one field to change');

            const result = ctx.doc.setFields('modify parts', ids.map((id) => ({ id, fields })));

            return ok(describeResult(ctx, { changed: result.changed, fields }));
        },
    );

    edit(
        'move_parts',
        'Shift parts by an offset, or everything inside a box. Use it to nudge a room, slide a prop '
        + 'off a wall it is clipping into, or lift a floating cluster down onto the floor.',
        {
            ids: z.array(z.string()).optional(),
            region: z.object(footprint).extend({ height: z.number().positive().default(200) }).optional(),
            offset: vector3.describe('how far to move, [dx, dy, dz]'),
        },
        async ({ ids, region, offset }) => {
            let hit;
            if (ids?.length) {
                hit = ids.map((id) => ctx.doc.require(id));
            } else if (region) {
                hit = partsInRegion(ctx.doc.parts, region);
            } else {
                throw new MapError('give either ids or a region');
            }
            if (!hit.length) throw new MapError('nothing matched');

            const result = ctx.doc.setFields('move parts', hit.map((p) => ({
                id: p._id,
                fields: {
                    P: [
                        round(p.P[0] + offset[0]),
                        round(p.P[1] + offset[1]),
                        round(p.P[2] + offset[2]),
                    ],
                },
            })));

            return ok(describeResult(ctx, { moved: result.changed, offset }));
        },
    );

    edit(
        'delete_parts',
        'Remove parts by id, or clear out a whole box. Deleting a region is one undoable action, so '
        + 'it is safe to use to wipe an area you want to rebuild.',
        {
            ids: z.array(z.string()).optional(),
            region: z.object(region3).optional(),
            contained: z.boolean().default(true)
                .describe('with a region: true removes only parts fully inside it, false removes anything touching it'),
        },
        async ({ ids, region, contained }) => {
            let targets;
            if (ids?.length) {
                targets = ids;
            } else if (region) {
                targets = partsInRegion(ctx.doc.parts, region, contained ? 'contain' : 'overlap')
                    .map((p) => p._id);
            } else {
                throw new MapError('give either ids or a region');
            }
            if (!targets.length) throw new MapError('nothing matched, so nothing was deleted');

            const result = ctx.doc.removeParts('delete parts', targets);

            return ok(describeResult(ctx, { deleted: result.removed }));
        },
    );

    edit(
        'undo',
        'Undo the last action this agent took. Every tool commits exactly one undoable action, even '
        + 'when it placed hundreds of parts, so this reliably reverses a whole room or scatter.',
        { steps: z.number().int().min(1).max(20).default(1) },
        async ({ steps }) => {
            const undone = [];
            for (let i = 0; i < steps; i++) {
                if (!ctx.doc.historyLabels.length) break;
                undone.push(ctx.doc.undo().undone);
            }
            if (!undone.length) throw new MapError('there is nothing to undo');

            return ok(describeResult(ctx, { undone }));
        },
    );

    edit(
        'redo',
        'Redo actions that undo reversed. Same granularity: one call brings back a whole room, '
        + 'corridor or scatter that you undid.',
        { steps: z.number().int().min(1).max(20).default(1) },
        async ({ steps }) => {
            const redone = [];
            for (let i = 0; i < steps; i++) {
                try {
                    redone.push(ctx.doc.redo().redone);
                } catch {
                    break;
                }
            }
            if (!redone.length) throw new MapError('there is nothing to redo');

            return ok(describeResult(ctx, { redone }));
        },
    );

    tool(
        'validate_map',
        'Run every correctness check at once: part and light limits, missing or blocked spawns, '
        + 'parts overlapping badly, anchored parts floating in mid air, stale folders, and areas the '
        + 'player cannot reach. Run this before you call a map finished.',
        {
            cell: z.number().positive().default(4)
                .describe('walkability sampling size; raise it on very large maps'),
            walkability: z.boolean().default(true),
        },
        async ({ cell, walkability: walk }) => ok(describeResult(ctx, validate(ctx.doc, {
            cell, walkability: walk,
        }))),
    );

    tool(
        'analyze_walkability',
        'Work out where the character can actually stand and walk, then group that floor into '
        + 'connected islands. Anything that is not connected to the island holding the spawn is '
        + 'unreachable, which is the most common way a good looking map is broken.',
        {
            cell: z.number().positive().default(4),
            allowJump: z.boolean().default(true)
                .describe('false treats anything above step height as impassable'),
        },
        async ({ cell, allowJump }) => {
            const result = walkability(ctx.doc.parts, { cell, allowJump });

            return ok(describeResult(ctx, {
                cell: result.cell,
                standableCells: result.standableCells,
                reachableCells: result.reachableCells,
                reachableFraction: result.standableCells
                    ? round(result.reachableCells / result.standableCells, 3)
                    : 0,
                islands: result.islands,
                unreachable: result.unreachable,
                verdict: result.unreachable.length
                    ? `${result.unreachable.length} areas cannot be reached from the spawn`
                    : 'every walkable area connects to the spawn',
            }));
        },
    );

    tool(
        'analyze_density',
        'Break the map into tiles and count how much is in each one, so you can see which areas are '
        + 'bare and which are cluttered. Use it to decide where decoration is still needed and where '
        + 'you have overdone it.',
        {
            cell: z.number().positive().default(4),
            window: z.number().positive().default(32).describe('tile size in world units'),
        },
        async ({ cell, window }) => {
            const result = density(ctx.doc.parts, { cell, window });
            const sorted = [...result.tiles].sort((a, b) => b.partsPerFloorCell - a.partsPerFloorCell);

            return ok(describeResult(ctx, {
                tileSize: result.window,
                tiles: result.tiles.length,
                crowded: sorted.slice(0, 8),
                empty: sorted.filter((t) => t.parts === 0).slice(0, 12),
                median: sorted.length
                    ? sorted[Math.floor(sorted.length / 2)].partsPerFloorCell
                    : 0,
            }));
        },
    );

    tool(
        'get_map_statistics',
        'Counts and distributions: parts by type and material, the colour palette actually in use, '
        + 'total volume and bounds. Useful for spotting that a map is all one grey colour.',
        {},
        async () => ok(describeResult(ctx, {
            ...statistics(ctx.doc.parts, ctx.doc.groups, ctx.doc.lighting),
            overlappingPairs: findOverlaps(ctx.doc.parts, { limit: 50 }).length,
            floatingParts: findUnsupported(ctx.doc.parts, { limit: 50 }).length,
        })),
    );

    tool(
        'render_map_preview',
        'Render the map to an image you can actually look at. This is how you check your own work: '
        + 'build something, render it, see what is wrong, fix it. Use view "top" as a floor plan to '
        + 'check layout and connections, and "iso" to judge how it looks. Pass a region to zoom into '
        + 'one room.',
        {
            view: z.enum(Object.keys(VIEWS)).default('iso')
                .describe(Object.entries(VIEWS).map(([k, v]) => `${k}: ${v.label}`).join('; ')),
            region: z.object(footprint).extend({
                height: z.number().positive().default(200),
            }).optional().describe('limit the picture to this footprint'),
            width: z.number().int().min(200).max(1600).default(900),
            height: z.number().int().min(200).max(1600).default(650),
            highlight: z.array(z.string()).optional()
                .describe('part ids to tint so you can find them in the picture'),
            fit: z.enum(['content', 'all']).default('content')
                .describe('content ignores the baseplate when framing, so the map fills the frame'),
        },
        async ({
            view, region, width, height, highlight, fit,
        }) => {
            if (!ctx.doc.parts.length) throw new MapError('the map is empty, there is nothing to render');

            const shot = renderMap(ctx.doc.parts, {
                view, region, width, height, highlight, fit,
            });
            if (!shot) throw new MapError('nothing is visible in that region');

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            view: shot.view,
                            camera: shot.described,
                            partsDrawn: shot.drew,
                            bounds: shot.bounds,
                            unitsPerPixel: shot.unitsPerPixel,
                            mode: ctx.live ? 'live' : 'offline',
                        }, null, 2),
                    },
                    {
                        type: 'image',
                        data: shot.png.toString('base64'),
                        mimeType: 'image/png',
                    },
                ],
            };
        },
    );
}

