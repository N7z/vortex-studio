plugin = {
    name = "Paint Brush",
    version = "1.0",
    icon = Icons.Paintbrush,
    brush = true,
    ui = {
        { id = "color", type = "color", label = "Colour", default = "e04b3a" },
        { id = "radius", type = "number", label = "Brush size", default = 12 },
        { id = "strength", type = "number", label = "Strength", default = 1 },
        { id = "jitter", type = "number", label = "Shade jitter", default = 0 },
        { id = "tr", type = "number", label = "Transparency", default = 0 },
        { id = "falloff", type = "checkbox", label = "Softer at the edge", default = false },
        { id = "settr", type = "checkbox", label = "Set transparency too", default = false },
        { id = "match", type = "text", label = "Only repaint this colour", default = "", max = 7 },
        { id = "fill", type = "button", label = "Paint the selection" },
    },
}

local MASK = 0xffffffff

local function clamp(v, lo, hi)
    v = tonumber(v)
    if v == nil or v ~= v then return lo end
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function bare(s)
    if type(s) ~= "string" then return nil end
    s = s:gsub("^#", ""):lower()
    if #s ~= 6 or s:match("%X") ~= nil then return nil end
    return s
end

local function parse(s)
    local h = bare(s)
    if h == nil then return nil end
    return tonumber(h:sub(1, 2), 16) / 255,
        tonumber(h:sub(3, 4), 16) / 255,
        tonumber(h:sub(5, 6), 16) / 255
end

local function hex(r, g, b)
    local function ch(v)
        return string.format("%02x", math.floor(clamp(v, 0, 1) * 255 + 0.5))
    end
    return ch(r) .. ch(g) .. ch(b)
end

local function mix(h, v)
    h = (h ~ (v & MASK)) & MASK
    h = (h * 16777619) & MASK
    return (h ~ (h >> 15)) & MASK
end

local function rng(part)
    local s = 2166136261
    for i = 1, 3 do
        s = mix(s, math.floor((tonumber(part.P[i]) or 0) * 16 + 0.5))
    end
    if s == 0 then s = 0x9e3779b9 end
    return function()
        s = s ~ ((s << 13) & MASK)
        s = s ~ (s >> 17)
        s = s ~ ((s << 5) & MASK)
        s = s & MASK
        return s / 4294967296.0
    end
end

local function shade(part, values, amount)
    local r, g, b = parse(values.color)
    if r == nil then return nil end

    local want = bare(values.match)
    if want ~= nil and want ~= bare(part.C) then return nil end

    local jit = clamp(values.jitter, 0, 1) * 0.5
    if jit > 0 then
        local roll = rng(part)
        r = r + (roll() * 2 - 1) * jit
        g = g + (roll() * 2 - 1) * jit
        b = b + (roll() * 2 - 1) * jit
    end

    amount = clamp(amount, 0, 1)
    if amount <= 0 then return nil end
    if amount < 1 then
        local cr, cg, cb = parse(part.C)
        if cr ~= nil then
            r = cr + (r - cr) * amount
            g = cg + (g - cg) * amount
            b = cb + (b - cb) * amount
        end
    end

    return hex(r, g, b)
end

local function patch(part, values, amount)
    local c = shade(part, values, amount)
    if c == nil then return nil end
    local out = { C = c }
    if values.settr then out.Tr = clamp(values.tr, 0, 1) end
    return out
end

local function strength(part, values)
    local amount = clamp(values.strength, 0, 1)
    if values.falloff then
        local d = clamp(part.D, 0, 1)
        amount = amount * (1 - d * d)
    end
    return amount
end

function plugin.paint(part, values)
    return patch(part, values, strength(part, values))
end

function plugin.click(id, part, values)
    if id ~= "fill" then return nil end
    local p = patch(part, values, clamp(values.strength, 0, 1))
    if p == nil then return nil end

    local out = {}
    for k, v in pairs(part) do out[k] = v end
    out.D = nil
    out.F = nil
    out.C = p.C
    if p.Tr ~= nil then out.Tr = p.Tr end
    out.Replace = true
    return out
end
