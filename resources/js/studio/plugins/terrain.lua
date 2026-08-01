plugin = {
    name = "Terrain",
    version = "1.0",
    icon = Icons.Mountain,
    ui = {
        { id = "res", type = "number", label = "Resolution", default = 40 },
        { id = "height", type = "number", label = "Height", default = 16 },
        { id = "octaves", type = "number", label = "Octaves", default = 4 },
        { id = "rough", type = "number", label = "Roughness", default = 0.5 },
        { id = "seed", type = "number", label = "Seed", default = 1 },
        { id = "tint", type = "checkbox", label = "Colour by height", default = true },
        { id = "build", type = "button", label = "Generate" },
    },
}

local MAX_RES = 120
local PREVIEW_RES = 16
local LEVELS = 16
local BASE_FREQ = 3.0

local function clamp(v, lo, hi)
    v = tonumber(v) or lo
    if v ~= v then return lo end
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function round(n)
    return math.floor(n * 1000 + 0.5) / 1000
end

local function hash2(x, z, seed)
    local h = (x * 374761393 + z * 668265263 + seed * 1274126177) & 0xFFFFFFFF
    h = (h ~ (h >> 13)) & 0xFFFFFFFF
    h = (h * 1274126177) & 0xFFFFFFFF
    h = (h ~ (h >> 16)) & 0xFFFFFFFF
    return h / 4294967296.0
end

local function smooth(t)
    return t * t * (3 - 2 * t)
end

local function value_noise(x, z, seed)
    local x0 = math.floor(x)
    local z0 = math.floor(z)
    local fx = smooth(x - x0)
    local fz = smooth(z - z0)
    local v00 = hash2(x0, z0, seed)
    local v10 = hash2(x0 + 1, z0, seed)
    local v01 = hash2(x0, z0 + 1, seed)
    local v11 = hash2(x0 + 1, z0 + 1, seed)
    local a = v00 + (v10 - v00) * fx
    local b = v01 + (v11 - v01) * fx
    return a + (b - a) * fz
end

local function fbm(x, z, seed, octaves, rough)
    local sum, amp, freq, total = 0, 1, 1, 0
    for i = 1, octaves do
        sum = sum + value_noise(x * freq, z * freq, seed + i * 7919) * amp
        total = total + amp
        amp = amp * rough
        freq = freq * 2
    end
    if total <= 0 then return 0 end
    return sum / total
end

local function ramp(t)
    if t < 0.06 then return "c9b884" end
    if t < 0.30 then return "5fa64a" end
    if t < 0.55 then return "3f7a35" end
    if t < 0.78 then return "7d7367" end
    if t < 0.90 then return "9c9691" end
    return "f2f6fa"
end

local function build(part, values, res)
    local height = clamp(tonumber(values.height) or 16, 0, 500)
    local octaves = math.floor(clamp(math.floor(tonumber(values.octaves) or 4), 1, 6))
    local rough = clamp(tonumber(values.rough) or 0.5, 0, 1)
    local seed = math.floor(clamp(math.floor(tonumber(values.seed) or 1), 0, 1000000))
    local tint = values.tint ~= false

    local w = math.abs(part.S[1])
    local d = math.abs(part.S[3])
    if w <= 0 or d <= 0 then return {} end

    local cw = w / res
    local cd = d / res
    local x0 = part.P[1] - w / 2
    local z0 = part.P[3] - d / 2
    local baseY = part.P[2] + part.S[2] / 2
    local step = height > 0 and (height / LEVELS) or 0

    local out = {}
    for ix = 0, res - 1 do
        for iz = 0, res - 1 do
            local u = (ix + 0.5) / res
            local v = (iz + 0.5) / res
            local n = fbm(u * BASE_FREQ, v * BASE_FREQ, seed, octaves, rough)
            local h = n * height
            if step > 0 then
                h = math.floor(h / step + 0.5) * step
            end
            if h < step then h = step end
            if h < 0.05 then h = 0.05 end
            out[#out + 1] = {
                T = "Part",
                P = {
                    round(x0 + (ix + 0.5) * cw),
                    round(baseY + h / 2),
                    round(z0 + (iz + 0.5) * cd),
                },
                S = { round(cw), round(h), round(cd) },
                R = { 0, 0, 0 },
                C = tint and ramp(height > 0 and (h / height) or 0) or (part.C or "9aa0a6"),
                Tr = 0,
            }
        end
    end
    return out
end

function plugin.preview(part, values)
    local res = math.floor(clamp(math.floor(tonumber(values.res) or 40), 2, MAX_RES))
    if res > PREVIEW_RES then res = PREVIEW_RES end
    return build(part, values, res)
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    local res = math.floor(clamp(math.floor(tonumber(values.res) or 40), 2, MAX_RES))
    return build(part, values, res)
end
