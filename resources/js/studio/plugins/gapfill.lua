plugin = {
    name = "Gap Fill",
    icon = Icons.Blend,
    faces = true,
    ui = {
        { id = "steps", type = "number", label = "Steps", default = 6 },
        { id = "blend", type = "checkbox", label = "Blend colour", default = true },
        { id = "overlap", type = "number", label = "Overlap", default = 0.05 },
        { id = "build", type = "button", label = "Fill" },
    },
}

local MAX_STEPS = 256

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

local function lerp(a, b, t)
    return a + (b - a) * t
end

local function hex_rgb(c)
    if type(c) ~= "string" then return nil end
    local s = c:gsub("^#", "")
    if #s ~= 6 then return nil end
    local r = tonumber(s:sub(1, 2), 16)
    local g = tonumber(s:sub(3, 4), 16)
    local b = tonumber(s:sub(5, 6), 16)
    if r == nil or g == nil or b == nil then return nil end
    return { r, g, b }
end

local function blend_hex(ca, cb, t)
    local a = hex_rgb(ca)
    local b = hex_rgb(cb)
    if a == nil and b == nil then return ca or cb or "ffffff" end
    if a == nil then return cb end
    if b == nil then return ca end
    local function ch(i)
        return clamp(math.floor(lerp(a[i], b[i], t) + 0.5), 0, 255)
    end
    return string.format("%02x%02x%02x", ch(1), ch(2), ch(3))
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

local function yaw_mat(a)
    local c, s = math.cos(a), math.sin(a)
    return { { c, 0, s }, { 0, 1, 0 }, { -s, 0, c } }
end

local function roll_mat(a)
    local c, s = math.cos(a), math.sin(a)
    return { { c, -s, 0 }, { s, c, 0 }, { 0, 0, 1 } }
end

local function aim_mat(dir)
    local flat = math.sqrt(dir[1] * dir[1] + dir[3] * dir[3])
    local theta = math.atan(-dir[3], dir[1])
    local phi = math.atan(dir[2], flat)
    return mat_mul(yaw_mat(theta), roll_mat(phi))
end

local function euler_of(m)
    local ex, ey, ez = mat_to_euler(m)
    return { round(math.deg(ex)), round(math.deg(ey)), round(math.deg(ez)) }
end

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

local function mat_of(part)
    return euler_to_mat(math.rad(part.R[1]), math.rad(part.R[2]), math.rad(part.R[3]))
end

local function col(m, k)
    return { m[1][k], m[2][k], m[3][k] }
end

local function dot(u, v)
    return u[1] * v[1] + u[2] * v[2] + u[3] * v[3]
end

local function chosen(part)
    local f = part.F
    if type(f) ~= "table" then return nil end
    for k = 1, 3 do
        local v = tonumber(f[k]) or 0
        if math.abs(v) > 0.5 then return k, (v < 0 and -1 or 1) end
    end
    return nil
end

local function face(part, m, dir)
    local best, sign = chosen(part)
    if best == nil then
        best, sign = 1, 1
        local score = -1
        for k = 1, 3 do
            local d = dot(col(m, k), dir)
            if math.abs(d) > score then
                score = math.abs(d)
                best = k
                sign = d < 0 and -1 or 1
            end
        end
    end
    local axis = col(m, best)
    local half = part.S[best] * 0.5 * sign
    local p = {
        part.P[1] + axis[1] * half,
        part.P[2] + axis[2] * half,
        part.P[3] + axis[3] * half,
    }
    local rest = {}
    for k = 1, 3 do
        if k ~= best then rest[#rest + 1] = k end
    end
    local up, side = rest[1], rest[2]
    if math.abs(col(m, side)[2]) > math.abs(col(m, up)[2]) then
        up, side = side, up
    end
    local n = { axis[1] * sign, axis[2] * sign, axis[3] * sign }
    return p, up, side, n
end

local function exit_dist(part, m, p, v)
    local o = { p[1] - part.P[1], p[2] - part.P[2], p[3] - part.P[3] }
    local t = math.huge
    for k = 1, 3 do
        local ax = col(m, k)
        local half = part.S[k] * 0.5
        local oc = dot(ax, o)
        local dc = dot(ax, v)
        if math.abs(dc) > 1e-6 then
            local tk = ((dc > 0 and half or -half) - oc) / dc
            if tk < t then t = tk end
        elseif math.abs(oc) > half then
            return 0
        end
    end
    if t == math.huge or t < 0 then return 0 end
    return t
end

local function bite(part, m, p, v, md, n, run, hu, hw)
    local c = math.abs(dot(n, run))
    if c > 0.9999 then return 0 end
    local deep = hu * math.abs(dot(col(md, 2), n)) + hw * math.abs(dot(col(md, 3), n))
    return math.min(deep / math.max(c, 0.2), exit_dist(part, m, p, v) * 0.95)
end

local function same_part(a, b)
    if a == nil or b == nil then return false end
    if a.P == nil or b.P == nil or a.S == nil or b.S == nil then return false end
    for i = 1, 3 do
        if math.abs(a.P[i] - b.P[i]) > 0.0005 then return false end
        if math.abs(a.S[i] - b.S[i]) > 0.0005 then return false end
    end
    return true
end

local function endpoints()
    if Selection == nil then return nil end
    if Selection.count ~= 2 then return nil end
    local list = Selection.parts
    if list == nil or list[1] == nil or list[2] == nil then return nil end
    return list[1], list[2]
end

local function bridge(values)
    local a, b = endpoints()
    if a == nil then return nil end

    local steps = math.floor(clamp(tonumber(values.steps) or 0, 0, MAX_STEPS))
    if steps < 1 then return nil end
    local overlap = clamp(tonumber(values.overlap) or 0, 0, 100)
    local blend = values.blend ~= false

    local d = { b.P[1] - a.P[1], b.P[2] - a.P[2], b.P[3] - a.P[3] }
    local dist = math.sqrt(d[1] * d[1] + d[2] * d[2] + d[3] * d[3])
    if dist < 0.001 then return nil end
    local dir = { d[1] / dist, d[2] / dist, d[3] / dist }

    local ma, mb = mat_of(a), mat_of(b)
    local pa, ua, wa, na = face(a, ma, dir)
    local pb, ub, wb, nb = face(b, mb, { -dir[1], -dir[2], -dir[3] })

    local g = { pb[1] - pa[1], pb[2] - pa[2], pb[3] - pa[3] }
    local glen = math.sqrt(g[1] * g[1] + g[2] * g[2] + g[3] * g[3])
    if glen < 0.001 or dot(g, dir) <= 0 then
        pa = { a.P[1], a.P[2], a.P[3] }
        g = { d[1], d[2], d[3] }
        glen = dist
        na = { dir[1], dir[2], dir[3] }
        nb = { -dir[1], -dir[2], -dir[3] }
    end
    local run = { g[1] / glen, g[2] / glen, g[3] / glen }

    local upright = math.abs(run[2]) > 0.9
    local md = upright and ma or aim_mat(run)
    local r = upright and { a.R[1], a.R[2], a.R[3] } or euler_of(md)

    local rev = { -run[1], -run[2], -run[3] }
    local back = bite(a, ma, pa, rev, md, na, run, a.S[ua] * 0.5, a.S[wa] * 0.5)
    local fwd = bite(b, mb, pb, run, md, nb, run, b.S[ub] * 0.5, b.S[wb] * 0.5)
    for k = 1, 3 do
        pa[k] = pa[k] - run[k] * back
    end
    glen = glen + back + fwd

    local seg = glen / steps

    local out = {}
    for i = 1, steps do
        local u = (i - 0.5) / steps

        local s = {}
        if upright then
            for k = 1, 3 do
                local along = math.abs(run[k])
                local cross = lerp(a.S[k], b.S[k], u)
                s[k] = cross * (1 - along) + seg * along
            end
        else
            s[1] = seg
            s[2] = lerp(a.S[ua], b.S[ub], u)
            s[3] = lerp(a.S[wa], b.S[wb], u)
        end
        for k = 1, 3 do
            s[k] = math.max(0.001, s[k] + overlap)
        end

        local p = {}
        for k = 1, 3 do
            p[k] = pa[k] + run[k] * seg * (i - 0.5)
        end

        local o = {
            P = { round(p[1]), round(p[2]), round(p[3]) },
            S = { round(s[1]), round(s[2]), round(s[3]) },
            R = { round(r[1]), round(r[2]), round(r[3]) },
            C = blend and blend_hex(a.C, b.C, u) or a.C,
        }
        if a.T ~= nil then o.T = a.T end
        if a.Tr ~= nil then o.Tr = round(lerp(tonumber(a.Tr) or 0, tonumber(b.Tr) or 0, u)) end
        out[#out + 1] = o
    end
    return out
end

function plugin.preview(part, values)
    return bridge(values)
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    local a = endpoints()
    if a == nil then return nil end
    if not same_part(part, a) then return nil end
    return bridge(values)
end
