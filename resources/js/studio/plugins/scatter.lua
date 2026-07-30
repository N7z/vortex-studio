plugin = {
    name = "Scatter",
    icon = Icons.Trees,
    ui = {
        { id = "density", type = "number", label = "Density", default = 0.35 },
        { id = "minsize", type = "number", label = "Min size", default = 6 },
        { id = "maxsize", type = "number", label = "Max size", default = 12 },
        { id = "seed", type = "number", label = "Seed", default = 1 },
        { id = "jitter", type = "number", label = "Colour jitter", default = 0.25 },
        { id = "trees", type = "checkbox", label = "Trees", default = true },
        { id = "rocks", type = "checkbox", label = "Rocks", default = true },
        { id = "build", type = "button", label = "Scatter" },
    },
}

local MASK = 0xffffffff

local function round(n)
    return math.floor(n * 1000 + 0.5) / 1000
end

local function clamp(v, lo, hi)
    v = tonumber(v) or lo
    if v ~= v then return lo end
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function mix(h, v)
    h = (h ~ (v & MASK)) & MASK
    h = (h * 16777619) & MASK
    h = h ~ (h >> 15)
    return h & MASK
end

local function quant(v)
    return math.floor((tonumber(v) or 0) * 16 + 0.5)
end

local function seed_for(part, seed)
    local h = 2166136261
    h = mix(h, math.floor(seed))
    h = mix(h, quant(part.P[1]))
    h = mix(h, quant(part.P[2]))
    h = mix(h, quant(part.P[3]))
    h = mix(h, quant(part.S[1]) * 3 + quant(part.S[3]))
    return h
end

local function rng(state)
    local s = state & MASK
    if s == 0 then s = 0x9e3779b9 end
    return function()
        s = s ~ ((s << 13) & MASK)
        s = s ~ (s >> 17)
        s = s ~ ((s << 5) & MASK)
        s = s & MASK
        return s / 4294967296.0
    end
end

local function span(r, lo, hi)
    return lo + (hi - lo) * r()
end

local function hex(rr, gg, bb)
    local function ch(v)
        v = math.floor(clamp(v, 0, 1) * 255 + 0.5)
        return string.format("%02x", v)
    end
    return ch(rr) .. ch(gg) .. ch(bb)
end

local function shade(r, base, amount)
    local out = {}
    for i = 1, 3 do
        out[i] = clamp(base[i] + (r() * 2 - 1) * amount, 0, 1)
    end
    return hex(out[1], out[2], out[3])
end

local TRUNK = { 0.36, 0.24, 0.14 }
local LEAF = { 0.20, 0.46, 0.20 }
local STONE = { 0.55, 0.55, 0.56 }

local function box(x, y, z, sx, sy, sz, rx, ry, rz, c)
    return {
        P = { round(x), round(y), round(z) },
        S = { round(sx), round(sy), round(sz) },
        R = { round(rx), round(ry), round(rz) },
        C = c,
    }
end

local function tree(r, x, y, z, size, jit)
    local out = {}
    local trunk_h = size * span(r, 0.34, 0.48)
    local trunk_w = size * span(r, 0.07, 0.11)
    local lean = span(r, -4, 4)
    out[#out + 1] = box(x, y + trunk_h / 2, z, trunk_w, trunk_h, trunk_w,
        lean, span(r, 0, 90), lean, shade(r, TRUNK, jit))

    local layers = 2 + math.floor(r() * 3)
    if layers > 4 then layers = 4 end
    local spread = size * span(r, 0.34, 0.48)
    local top = y + trunk_h * 0.82
    for i = 1, layers do
        local t = (i - 1) / layers
        local w = spread * (1 - 0.22 * (i - 1))
        local h = size * 0.26 * (1 - 0.14 * (i - 1))
        local cy = top + h / 2 + t * size * 0.34
        out[#out + 1] = box(
            x + span(r, -1, 1) * spread * 0.18,
            cy,
            z + span(r, -1, 1) * spread * 0.18,
            w, h, w,
            span(r, -9, 9), span(r, 0, 90), span(r, -9, 9),
            shade(r, LEAF, jit))
    end
    return out
end

local function rock(r, x, y, z, size, jit)
    local out = {}
    local lumps = 2 + math.floor(r() * 2)
    if lumps > 3 then lumps = 3 end
    for i = 1, lumps do
        local w = size * span(r, 0.34, 0.62)
        local h = size * span(r, 0.22, 0.42)
        local d = size * span(r, 0.34, 0.62)
        local ox = (i == 1) and 0 or span(r, -1, 1) * size * 0.22
        local oz = (i == 1) and 0 or span(r, -1, 1) * size * 0.22
        out[#out + 1] = box(
            x + ox, y + h / 2 - size * 0.04, z + oz,
            w, h, d,
            span(r, -12, 12), span(r, 0, 90), span(r, -12, 12),
            shade(r, STONE, jit))
    end
    return out
end

local function prop_on(part, values, force)
    local seed = math.floor(tonumber(values.seed) or 0)
    local jit = clamp(values.jitter, 0, 1) * 0.35
    local lo = math.max(0.2, tonumber(values.minsize) or 1)
    local hi = math.max(lo, tonumber(values.maxsize) or lo)
    local trees = values.trees ~= false
    local rocks = values.rocks and true or false
    if not trees and not rocks then return nil end

    local r = rng(seed_for(part, seed))
    local roll = r()
    if not force and roll >= clamp(values.density, 0, 1) then return nil end

    local x = part.P[1] + (r() * 2 - 1) * part.S[1] * 0.42
    local z = part.P[3] + (r() * 2 - 1) * part.S[3] * 0.42
    local y = part.P[2] + part.S[2] / 2

    local size = span(r, lo, hi)
    local pick = r()
    local want_tree = trees and (not rocks or pick < 0.62)
    if want_tree then return tree(r, x, y, z, size, jit) end
    return rock(r, x, y, z, size, jit)
end

function plugin.preview(part, values)
    return prop_on(part, values, true)
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return prop_on(part, values, false)
end
