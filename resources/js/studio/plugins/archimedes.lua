plugin = {
    name = "Archimedes",
    version = "1.0",
    icon = Icons.DraftingCompass,
    ui = {
        { id = "x", type = "number", label = "X", default = 0 },
        { id = "y", type = "number", label = "Y", default = 10 },
        { id = "z", type = "number", label = "Z", default = 0 },
        { id = "reverse", type = "checkbox", label = "Reverse direction", default = false },
        { id = "stamp", type = "button", label = "Stamp next part" },
    },
}

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

local function round(n)
    return math.floor(n * 100 + 0.5) / 100
end

local function next_part(part, values)
    local h = part.S[3] / 2 * (values.reverse and -1 or 1)
    local sel = euler_to_mat(math.rad(part.R[1]), math.rad(part.R[2]), math.rad(part.R[3]))
    local turn = euler_to_mat(math.rad(values.x), math.rad(values.y), math.rad(values.z))
    local combined = mat_mul(sel, turn)
    local off1 = mat_vec(sel, { 0, 0, h })
    local off2 = mat_vec(combined, { 0, 0, h })
    local ex, ey, ez = mat_to_euler(combined)

    local out = {}
    for k, v in pairs(part) do
        out[k] = v
    end
    out.P = {
        round(part.P[1] + off1[1] + off2[1]),
        round(part.P[2] + off1[2] + off2[2]),
        round(part.P[3] + off1[3] + off2[3]),
    }
    out.R = { round(math.deg(ex)), round(math.deg(ey)), round(math.deg(ez)) }
    out.S = { part.S[1], part.S[2], part.S[3] }
    return out
end

function plugin.preview(part, values)
    return next_part(part, values)
end

function plugin.click(id, part, values)
    if id == "stamp" then
        return next_part(part, values)
    end
end
