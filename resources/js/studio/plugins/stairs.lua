plugin = {
    name = "Stairs",
    icon = Icons.TrendingUp,
    ui = {
        { id = "steps", type = "number", label = "Steps", default = 10 },
        { id = "rise", type = "number", label = "Rise per step", default = 1 },
        { id = "run", type = "number", label = "Run per step", default = 2 },
        { id = "ramp", type = "checkbox", label = "Ramp", default = false },
        { id = "spiral", type = "checkbox", label = "Spiral", default = false },
        { id = "radius", type = "number", label = "Radius", default = 8 },
        { id = "degrees", type = "number", label = "Degrees per step", default = 15 },
        { id = "build", type = "button", label = "Build" },
    },
}

local MAX_PREVIEW = 256
local MAX_STEPS = 2000

local function euler_to_mat(x, y, z)
    local a, b = math.cos(x), math.sin(x)
    local c, d = math.cos(y), math.sin(y)
    local e, f = math.cos(z), math.sin(z)
    local ae, af, be, bf = a * e, a * f, b * e, b * f
    return {
        { c * e, -c * f, d },
        { af + be * d, ae - bf * d, -b * c },
        { bf - ae * d, be + af * d, a * c },
    }
end

local function mat_to_euler(m)
    local m13 = math.max(-1, math.min(1, m[1][3]))
    local y = math.asin(m13)
    local x, z
    if math.abs(m13) < 0.9999999 then
        x = math.atan(-m[2][3], m[3][3])
        z = math.atan(-m[1][2], m[1][1])
    else
        x = math.atan(m[3][2], m[2][2])
        z = 0
    end
    return x, y, z
end

local function mat_mul(a, b)
    local r = { {}, {}, {} }
    for i = 1, 3 do
        for j = 1, 3 do
            r[i][j] = a[i][1] * b[1][j] + a[i][2] * b[2][j] + a[i][3] * b[3][j]
        end
    end
    return r
end

local function mat_vec(m, v)
    return {
        m[1][1] * v[1] + m[1][2] * v[2] + m[1][3] * v[3],
        m[2][1] * v[1] + m[2][2] * v[2] + m[2][3] * v[3],
        m[3][1] * v[1] + m[3][2] * v[2] + m[3][3] * v[3],
    }
end

local function yaw_mat(a)
    local c, s = math.cos(a), math.sin(a)
    return {
        { c, 0, s },
        { 0, 1, 0 },
        { -s, 0, c },
    }
end

local function pitch_mat(a)
    local c, s = math.cos(a), math.sin(a)
    return {
        { 1, 0, 0 },
        { 0, c, -s },
        { 0, s, c },
    }
end

local function round(n)
    return math.floor(n * 1000 + 0.5) / 1000
end

local function clone(part)
    local out = {}
    for k, v in pairs(part) do
        out[k] = v
    end
    out.P = { part.P[1], part.P[2], part.P[3] }
    out.S = { part.S[1], part.S[2], part.S[3] }
    out.R = { part.R[1], part.R[2], part.R[3] }
    out.Replace = nil
    return out
end

local function emit(part, p, s, m)
    local out = clone(part)
    local ex, ey, ez = mat_to_euler(m)
    out.P = { round(p[1]), round(p[2]), round(p[3]) }
    out.S = { round(s[1]), round(s[2]), round(s[3]) }
    out.R = { round(math.deg(ex)), round(math.deg(ey)), round(math.deg(ez)) }
    return out
end

local function build(part, values, limit)
    local steps = math.floor(tonumber(values.steps) or 0)
    if steps < 1 then return nil end
    if steps > MAX_STEPS then steps = MAX_STEPS end

    local rise = tonumber(values.rise) or 0
    local run = tonumber(values.run) or 0
    local seed = euler_to_mat(math.rad(part.R[1]), math.rad(part.R[2]), math.rad(part.R[3]))

    if values.spiral == true then
        local radius = tonumber(values.radius) or 0
        local per = math.rad(tonumber(values.degrees) or 0)
        local centre = mat_vec(seed, { radius, 0, 0 })
        local cx = part.P[1] + centre[1]
        local cy = part.P[2] + centre[2]
        local cz = part.P[3] + centre[3]
        local arm = { part.P[1] - cx, part.P[2] - cy, part.P[3] - cz }
        local out = {}
        local n = steps
        if limit ~= nil and n > limit then n = limit end
        for i = 1, n do
            local ry = yaw_mat(i * per)
            local v = mat_vec(ry, arm)
            local p = { cx + v[1], cy + v[2] + i * rise, cz + v[3] }
            out[#out + 1] = emit(part, p, part.S, mat_mul(ry, seed))
        end
        return out
    end

    if values.ramp == true then
        local length = math.sqrt((steps * run) ^ 2 + (steps * rise) ^ 2)
        if length <= 0 then return nil end
        local pitch = -math.atan(rise, run)
        local m = mat_mul(seed, pitch_mat(pitch))
        local off = mat_vec(seed, { 0, steps * rise / 2, steps * run / 2 })
        local p = { part.P[1] + off[1], part.P[2] + off[2], part.P[3] + off[3] }
        return emit(part, p, { part.S[1], part.S[2], length }, m)
    end

    local out = {}
    local n = steps
    if limit ~= nil and n > limit then n = limit end
    for i = 1, n do
        local off = mat_vec(seed, { 0, i * rise, i * run })
        local p = { part.P[1] + off[1], part.P[2] + off[2], part.P[3] + off[3] }
        out[#out + 1] = emit(part, p, part.S, seed)
    end
    return out
end

function plugin.preview(part, values)
    return build(part, values, MAX_PREVIEW)
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return build(part, values, nil)
end
