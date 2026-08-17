// Reading and writing the official Vortex Studio `.vrtx` project file.
//
// As of Studio v0.2.1 a saved project is no longer JSON on disk. A `.vrtx` file is:
//
//     "VRTX"            4 byte ASCII magic
//     0x01              one byte container version
//     <zstd frame>      which decompresses to:
//         0x01          one byte inner schema version
//         <bincode>     the ProjectData struct, bincode's classic little-endian
//                       fixed-width-integer encoding (what bincode::serialize writes)
//
// The Studio still opens the old plain JSON, so we keep reading both; we only write
// the new one by default. The object we encode and decode is exactly the one
// `toProject` builds and `fromProject` consumes — this module is just the
// container, the field mapping stays in vortexProject.js and is shared with JSON.

import { decompress as zstdDecompress } from 'fzstd';

const MAGIC = [0x56, 0x52, 0x54, 0x58]; // "VRTX"
const CONTAINER_VERSION = 1;
const SCHEMA_VERSION = 1;

// Enums serialise as their *index*, not their name, so these arrays are the
// on-disk meaning of each value and their order is the Studio's declaration order,
// recovered from the binary and checked against a real save. Note `Smooth` sits at
// index 0 of the materials — our own list starts at Plastic, so map through here.
const MATERIALS = ['Smooth', 'Plastic', 'Wood', 'Metal', 'Grass', 'Ice', 'Paint'];
const FACES = ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'];
const TEXTURE_KINDS = ['Studs', 'Inlets'];

export class VrtxError extends Error {}

// --- bincode primitives --------------------------------------------------
//
// A growable little-endian writer. Lengths are u64 (8 bytes), enum tags u32
// (4 bytes), floats f32, bools one byte, Option a one byte 0/1 tag.
class Writer {
    constructor() {
        this.buf = new Uint8Array(1024);
        this.view = new DataView(this.buf.buffer);
        this.len = 0;
    }

    _room(n) {
        if (this.len + n <= this.buf.length) return;
        let next = this.buf.length * 2;
        while (next < this.len + n) next *= 2;
        const grown = new Uint8Array(next);
        grown.set(this.buf.subarray(0, this.len));
        this.buf = grown;
        this.view = new DataView(this.buf.buffer);
    }

    u8(v) { this._room(1); this.view.setUint8(this.len, v & 0xff); this.len += 1; }
    bool(v) { this.u8(v ? 1 : 0); }
    u32(v) { this._room(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; }
    len64(v) { this._room(8); this.view.setBigUint64(this.len, BigInt(v), true); this.len += 8; }
    f32(v) { this._room(4); this.view.setFloat32(this.len, Number.isFinite(v) ? v : 0, true); this.len += 4; }

    str(s) {
        const bytes = new TextEncoder().encode(String(s ?? ''));
        this.len64(bytes.length);
        this._room(bytes.length);
        this.buf.set(bytes, this.len);
        this.len += bytes.length;
    }

    take() { return this.buf.slice(0, this.len); }
}

// A little-endian reader that refuses to run off the end.
class Reader {
    constructor(bytes) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.at = 0;
    }

    _need(n) {
        if (this.at + n > this.bytes.length) {
            throw new VrtxError('the .vrtx file ends in the middle of a value');
        }
    }

    u8() { this._need(1); const v = this.view.getUint8(this.at); this.at += 1; return v; }
    bool() { return this.u8() !== 0; }
    u32() { this._need(4); const v = this.view.getUint32(this.at, true); this.at += 4; return v; }

    len64() {
        this._need(8);
        const v = this.view.getBigUint64(this.at, true);
        this.at += 8;
        if (v > 0x7fffffffn) throw new VrtxError('a length in the .vrtx file is implausibly large');
        return Number(v);
    }

    f32() { this._need(4); const v = this.view.getFloat32(this.at, true); this.at += 4; return v; }

    str() {
        const n = this.len64();
        this._need(n);
        const slice = this.bytes.subarray(this.at, this.at + n);
        this.at += n;
        return new TextDecoder().decode(slice);
    }

    option(readSome) {
        const tag = this.u8();
        if (tag === 0) return null;
        if (tag !== 1) throw new VrtxError(`invalid Option tag ${tag} in the .vrtx file`);
        return readSome();
    }

    vec(readItem) {
        const n = this.len64();
        const out = new Array(n);
        for (let i = 0; i < n; i += 1) out[i] = readItem();
        return out;
    }

    enumName(table, what) {
        const i = this.u32();
        if (i >= table.length) throw new VrtxError(`unknown ${what} index ${i} in the .vrtx file`);
        return table[i];
    }
}

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
// An unknown material (e.g. the Studio's "Smooth", which we do not model) falls
// back to the default so the file is still valid.
const enumIndex = (table, name, fallback = 0) => {
    const i = table.indexOf(name);
    return i < 0 ? fallback : i;
};

// --- ProjectData ---------------------------------------------------------

const writeVec3 = (w, v) => { w.f32(num(v?.x)); w.f32(num(v?.y)); w.f32(num(v?.z)); };
const readVec3 = (r) => ({ x: r.f32(), y: r.f32(), z: r.f32() });

const writeQuat = (w, q) => { w.f32(num(q?.x)); w.f32(num(q?.y)); w.f32(num(q?.z)); w.f32(num(q?.w, 1)); };
const readQuat = (r) => ({ x: r.f32(), y: r.f32(), z: r.f32(), w: r.f32() });

const writeColor = (w, c) => { w.f32(num(c?.r, 1)); w.f32(num(c?.g, 1)); w.f32(num(c?.b, 1)); w.f32(num(c?.a, 1)); };
const readColor = (r) => ({ r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32() });

function writePointLight(w, l) {
    writeColor(w, l.color);
    w.f32(num(l.intensity));
    w.f32(num(l.range));
    w.bool(l.shadow_maps_enabled === true);
}
const readPointLight = (r) => ({
    color: readColor(r), intensity: r.f32(), range: r.f32(), shadow_maps_enabled: r.bool(),
});

function writeSpotLight(w, l) {
    writeColor(w, l.color);
    w.f32(num(l.intensity));
    w.f32(num(l.range));
    w.bool(l.shadow_maps_enabled === true);
    w.f32(num(l.angle));
    w.u32(enumIndex(FACES, l.face));
}
const readSpotLight = (r) => ({
    color: readColor(r),
    intensity: r.f32(),
    range: r.f32(),
    shadow_maps_enabled: r.bool(),
    angle: r.f32(),
    face: r.enumName(FACES, 'spot light face'),
});

function writePart(w, p) {
    w.str(p.name ?? '');
    writeVec3(w, p.position);
    writeQuat(w, p.rotation);
    writeVec3(w, p.scale);
    writeColor(w, p.color);
    w.u32(enumIndex(MATERIALS, p.material ?? 'Plastic', enumIndex(MATERIALS, 'Plastic')));
    // group is an Option<u64> index into the top-level groups array.
    if (Number.isInteger(p.group) && p.group >= 0) { w.u8(1); w.len64(p.group); } else w.u8(0);
    w.bool(p.cast_shadow !== false);
    w.bool(p.anchored !== false);
    w.bool(p.can_collide !== false);
    w.bool(p.spawn_location === true);
    w.bool(p.baseplate === true);
    w.bool(p.custom_appearance === true);
    w.bool(p.truss === true);
    const textures = Array.isArray(p.textures) ? p.textures : [];
    w.len64(textures.length);
    for (const t of textures) {
        w.u32(enumIndex(FACES, t.face));
        w.u32(enumIndex(TEXTURE_KINDS, t.kind));
    }
    if (p.point_light) { w.u8(1); writePointLight(w, p.point_light); } else w.u8(0);
    if (p.spot_light) { w.u8(1); writeSpotLight(w, p.spot_light); } else w.u8(0);
}

const readPart = (r) => ({
    name: r.str(),
    position: readVec3(r),
    rotation: readQuat(r),
    scale: readVec3(r),
    color: readColor(r),
    material: r.enumName(MATERIALS, 'material'),
    group: r.option(() => r.len64()),
    cast_shadow: r.bool(),
    anchored: r.bool(),
    can_collide: r.bool(),
    spawn_location: r.bool(),
    baseplate: r.bool(),
    custom_appearance: r.bool(),
    truss: r.bool(),
    textures: r.vec(() => ({
        face: r.enumName(FACES, 'texture face'),
        kind: r.enumName(TEXTURE_KINDS, 'texture kind'),
    })),
    point_light: r.option(() => readPointLight(r)),
    spot_light: r.option(() => readSpotLight(r)),
});

function writeLighting(w, l) {
    const lit = l ?? {};
    writeColor(w, lit.ambient_color);
    w.f32(num(lit.brightness));
    writeColor(w, lit.sun_color);
    w.f32(num(lit.sun_illuminance));
    w.bool(lit.sun_shadow_maps_enabled !== false);
    writeQuat(w, lit.sun_rotation); // identity when absent
}
const readLighting = (r) => ({
    ambient_color: readColor(r),
    brightness: r.f32(),
    sun_color: readColor(r),
    sun_illuminance: r.f32(),
    sun_shadow_maps_enabled: r.bool(),
    sun_rotation: readQuat(r),
});

function writeGroup(w, g) {
    w.str(g.name ?? '');
    if (Number.isInteger(g.parent_group) && g.parent_group >= 0) { w.u8(1); w.len64(g.parent_group); } else w.u8(0);
}
const readGroup = (r) => ({ name: r.str(), parent_group: r.option(() => r.len64()) });

function writeProject(w, project) {
    w.str(project.project_id ?? '');
    const parts = Array.isArray(project.parts) ? project.parts : [];
    w.len64(parts.length);
    for (const p of parts) writePart(w, p);
    writeLighting(w, project.lighting);
    const groups = Array.isArray(project.groups) ? project.groups : [];
    w.len64(groups.length);
    for (const g of groups) writeGroup(w, g);
}

const readProject = (r) => ({
    project_id: r.str(),
    parts: r.vec(() => readPart(r)),
    lighting: readLighting(r),
    groups: r.vec(() => readGroup(r)),
});

// --- zstd container ------------------------------------------------------
//
// Decompression uses fzstd. For compression we emit a valid zstd frame made of
// raw (uncompressed) blocks: this needs no compressor dependency and any
// spec-compliant zstd decoder — the Studio's included — accepts it.
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const RAW_BLOCK_MAX = 1 << 17; // 128 KiB, the largest a single block may hold

function zstdWrapRaw(payload) {
    const out = [];
    out.push(...ZSTD_MAGIC);
    // Frame header: Single_Segment set, Frame_Content_Size as a full 8-byte field
    // (descriptor 0xE0), no window descriptor, no checksum, no dictionary.
    out.push(0xe0);
    const size = new Uint8Array(8);
    new DataView(size.buffer).setBigUint64(0, BigInt(payload.length), true);
    out.push(...size);
    // Raw data blocks: header is 3 bytes little-endian = (len << 3) | (0 << 1) | last.
    if (payload.length === 0) {
        out.push(0x01, 0x00, 0x00); // a single empty last block
    } else {
        for (let off = 0; off < payload.length; off += RAW_BLOCK_MAX) {
            const chunk = payload.subarray(off, Math.min(off + RAW_BLOCK_MAX, payload.length));
            const last = off + RAW_BLOCK_MAX >= payload.length ? 1 : 0;
            const header = (chunk.length << 3) | last;
            out.push(header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff);
            out.push(...chunk);
        }
    }

    return Uint8Array.from(out);
}

/** True when these bytes begin with the `VRTX` magic. */
export function isVrtx(bytes) {
    return !!bytes && bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Serialise the object `toProject` returns into `.vrtx` bytes.
 * @returns {Uint8Array}
 */
export function encodeVrtx(project) {
    const inner = new Writer();
    inner.u8(SCHEMA_VERSION);
    writeProject(inner, project);
    const frame = zstdWrapRaw(inner.take());

    const out = new Uint8Array(MAGIC.length + 1 + frame.length);
    out.set(MAGIC, 0);
    out[MAGIC.length] = CONTAINER_VERSION;
    out.set(frame, MAGIC.length + 1);

    return out;
}

/**
 * Parse `.vrtx` bytes back into the same object shape `fromProject` consumes.
 * Throws {@link VrtxError} on a bad magic, an unsupported version or a corrupt file.
 */
export function decodeVrtx(bytes) {
    if (!isVrtx(bytes)) throw new VrtxError('not a .vrtx file');
    if (bytes.length < MAGIC.length + 1) throw new VrtxError('the .vrtx file is truncated');
    const container = bytes[MAGIC.length];
    if (container !== CONTAINER_VERSION) throw new VrtxError(`unsupported .vrtx version ${container}`);

    let payload;
    try {
        payload = zstdDecompress(bytes.subarray(MAGIC.length + 1));
    } catch (e) {
        throw new VrtxError(`the .vrtx file is not valid zstd: ${e.message ?? e}`);
    }

    const r = new Reader(payload);
    const schema = r.u8();
    if (schema !== SCHEMA_VERSION) throw new VrtxError(`unsupported .vrtx schema version ${schema}`);

    return readProject(r);
}
