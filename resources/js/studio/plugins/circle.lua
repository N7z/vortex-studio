plugin = {
    name = "Circle",
    version = "1.1",
    icon = Icons.Circle,
    ui = {
        { id = "radius", type = "number", label = "Radius", default = 12 },
        { id = "width", type = "number", label = "Ring width", default = 1 },
        { id = "layers", type = "number", label = "Layers", default = 1 },
        { id = "fill", type = "checkbox", label = "Fill the circle", default = false },
        { id = "upright", type = "checkbox", label = "Stand it upright", default = false },
        { id = "smooth", type = "checkbox", label = "Smooth ring", default = false },
        { id = "segments", type = "number", label = "Segments", default = 32 },
        { id = "build", type = "button", label = "Build circle" },
    },
}

local MAX_PREVIEW = 400
local MAX_SEGMENTS = 720

local function maxParts()
    return (Limits and Limits.parts) or 50000
end

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

local function cross(a, b)
    return {
        a[2] * b[3] - a[3] * b[2],
        a[3] * b[1] - a[1] * b[3],
        a[1] * b[2] - a[2] * b[1],
    }
end

local function axes_to_euler(ax, ay, az)
    local ex, ey, ez = mat_to_euler({
        { ax[1], ay[1], az[1] },
        { ax[2], ay[2], az[2] },
        { ax[3], ay[3], az[3] },
    })
    return { round(math.deg(ex)), round(math.deg(ey)), round(math.deg(ez)) }
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

local function emit(part, p, s, r)
    local out = clone(part)
    out.P = { round(p[1]), round(p[2]), round(p[3]) }
    out.S = { round(s[1]), round(s[2]), round(s[3]) }
    if r ~= nil then out.R = r end
    return out
end

local function plane(upright)
    if upright then return 1, 2, 3 end
    return 1, 3, 2
end

local function blocks(part, values, limit)
    local radius = clamp(values.radius, 0.1, 4000)
    local layers = math.floor(clamp(values.layers, 1, 4000))
    local fill = values.fill == true
    local iu, iv, inml = plane(values.upright == true)

    local cu = math.max(math.abs(part.S[iu]), 0.05)
    local cv = math.max(math.abs(part.S[iv]), 0.05)
    local cn = math.max(math.abs(part.S[inml]), 0.05)

    local width = clamp(values.width, 0, 4000)
    if width < math.max(cu, cv) then width = math.max(cu, cv) end
    local inner = fill and -1 or (radius - width)

    local nu = math.floor(radius / cu) + 1
    local nv = math.floor(radius / cv) + 1
    local cap = limit or maxParts()

    local out = {}
    for i = -nu, nu do
        local du = i * cu
        for j = -nv, nv do
            local dv = j * cv
            local d = math.sqrt(du * du + dv * dv)
            if d <= radius and d >= inner then
                for k = 0, layers - 1 do
                    if #out >= cap then return out end
                    local p = { part.P[1], part.P[2], part.P[3] }
                    p[iu] = p[iu] + du
                    p[iv] = p[iv] + dv
                    p[inml] = p[inml] + k * cn
                    out[#out + 1] = emit(part, p, part.S, nil)
                end
            end
        end
        progress(i + nu + 1, nu * 2 + 1)
    end
    return out
end

local function smooth_setup(part, values)
    local upright = values.upright == true
    local iu, iv, inml = plane(upright)
    local u, v = { 0, 0, 0 }, { 0, 0, 0 }
    u[iu], v[iv] = 1, 1

    local radius = clamp(values.radius, 0.1, 4000)
    local width = clamp(values.width, 0.05, radius)
    local step = upright and width or math.max(math.abs(part.S[2]), 0.05)

    return {
        u = u,
        v = v,
        upright = upright,
        inml = inml,
        radius = radius,
        width = width,
        step = step,
        layers = math.floor(clamp(values.layers, 1, 4000)),
        count = math.floor(clamp(values.segments, 3, MAX_SEGMENTS)),
    }
end

local function arc(part, ctx, out, cap, outer, w, count)
    local mid = outer - w / 2
    local length = 2 * outer * math.tan(math.pi / count)
    local u, v = ctx.u, ctx.v

    for i = 0, count - 1 do
        local a = 2 * math.pi * i / count
        local ca, sa = math.cos(a), math.sin(a)
        local radial = {
            u[1] * ca + v[1] * sa,
            u[2] * ca + v[2] * sa,
            u[3] * ca + v[3] * sa,
        }
        local az = {
            -u[1] * sa + v[1] * ca,
            -u[2] * sa + v[2] * ca,
            -u[3] * sa + v[3] * ca,
        }
        local ay = ctx.upright and radial or { 0, 1, 0 }
        local ax = cross(ay, az)
        local r = axes_to_euler(ax, ay, az)

        for k = 0, ctx.layers - 1 do
            if #out >= cap then return false end
            local p = {
                part.P[1] + radial[1] * mid,
                part.P[2] + radial[2] * mid,
                part.P[3] + radial[3] * mid,
            }
            p[ctx.inml] = p[ctx.inml] + k * ctx.step
            local s = { part.S[1], part.S[2], part.S[3] }
            s[1] = w
            s[3] = length
            out[#out + 1] = emit(part, p, s, r)
        end
    end
    return true
end

local function ring(part, values, limit)
    local ctx = smooth_setup(part, values)
    local out = {}
    arc(part, ctx, out, limit or maxParts(), ctx.radius, ctx.width, ctx.count)
    progress(1, 1)
    return out
end

local function disc(part, values, limit)
    local ctx = smooth_setup(part, values)
    local cap = limit or maxParts()
    local out = {}
    local outer = ctx.radius
    local rings = math.ceil(ctx.radius / ctx.width)

    for i = 1, rings do
        local n = math.floor(ctx.count * outer / ctx.radius + 0.5)
        if n < 3 then n = 3 end
        local next_outer = outer - ctx.width
        if next_outer < 0.001 then next_outer = 0 end
        local w = outer - next_outer * math.cos(math.pi / n)
        if not arc(part, ctx, out, cap, outer, w, n) then return out end
        outer = next_outer
        progress(i, rings)
        if outer <= 0 then break end
    end
    return out
end

local function build(part, values, limit)
    if values.smooth == true then
        if values.fill == true then return disc(part, values, limit) end
        return ring(part, values, limit)
    end
    return blocks(part, values, limit)
end

function plugin.preview(part, values)
    return build(part, values, MAX_PREVIEW)
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return build(part, values, nil)
end
