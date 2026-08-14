#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { config } from './config.js';
import { Context, register } from './tools.js';

const INSTRUCTIONS = `Vortex Studio is a 3D map editor. A map is a flat list of parts: boxes with a
centre position P, a full size S, a rotation R in degrees, a colour, a material and optional per face
textures. X and Z are the ground plane and Y is up. There are no tiles and no layers.

Work like this:
1. get_map_constraints and get_available_assets, so you know what the character needs and what you
   can build with.
2. get_map_info and render_map_preview with view "top" to see what is already there.
3. Build with the semantic tools (create_room, create_roof, connect_rooms, create_corridor,
   create_stairs, scatter_props, generate_terrain) rather than placing parts one at a time. Each call is one
   undoable action.
4. Render again and LOOK at the image. Check for walls that do not meet, props clipping into each
   other, doorways that lead nowhere and areas that are visually empty.
5. validate_map and analyze_walkability to catch what the eye misses, especially unreachable areas.
6. Fix with carve_opening, move_parts, modify_parts, paint_region or delete_parts, then render again.

Folders are how the map is organised, and a part lives in exactly one of them. create_room makes a
folder; anything you add to that room afterwards belongs in the same one, so pass its name or id as
the folder of place_parts, place_prop or scatter_props, which extends it rather than making a second
folder of the same name. Parts already in the wrong place are fixed with group_parts, rename_folder
and delete_folder, so never delete and rebuild geometry just to tidy the grouping.

The front, side and top views each flatten one axis, so a slope only reads as a slope in a view that
does not flatten the axis it runs along. Check a pitched roof from the side, not the front.

connect_live attaches to a live editing room so the user watches you build in real time. Without it
you work on an offline copy that save_map writes back.`;

const server = new McpServer(
    { name: 'vortex-studio', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
);

register(server, new Context(config));

await server.connect(new StdioServerTransport());
