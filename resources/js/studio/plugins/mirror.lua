plugin = {
    name = "Mirror",
    icon = Icons.FlipHorizontal,
    ui = {
        { id = "mx", type = "checkbox", label = "Mirror X", default = true },
        { id = "my", type = "checkbox", label = "Mirror Y", default = false },
        { id = "mz", type = "checkbox", label = "Mirror Z", default = false },
        { id = "origin", type = "checkbox", label = "Around the selection", default = true },
        { id = "copy", type = "checkbox", label = "Create a copy", default = true },
        { id = "px", type = "number", label = "Plane X", default = 0 },
        { id = "py", type = "number", label = "Plane Y", default = 0 },
        { id = "pz", type = "number", label = "Plane Z", default = 0 },
        { id = "build", type = "button", label = "Mirror" },
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

local function round(n)
    return math.floor(n * 1000 + 0.5) / 1000
end

local function conjugate(r, sx, sy, sz)
    local s = { sx, sy, sz }
    local out = { {}, {}, {} }
    for i = 1, 3 do
        for j = 1, 3 do
            out[i][j] = s[i] * r[i][j] * s[j]
        end
    end
    return out
end

local function flip(part, values)
    local mx = values.mx and true or false
    local my = values.my and true or false
    local mz = values.mz and true or false
    if not (mx or my or mz) then return nil end

    local px = tonumber(values.px) or 0
    local py = tonumber(values.py) or 0
    local pz = tonumber(values.pz) or 0

    -- "Around the selection" needs the bounds of everything selected, which a
    -- plugin cannot see: it is called one part at a time. The app hands them over.
    if values.origin ~= false and Selection ~= nil then
        px, py, pz = Selection.center[1], Selection.center[2], Selection.center[3]
    end

    local out = {}
    for k, v in pairs(part) do
        out[k] = v
    end

    out.P = {
        round(mx and (2 * px - part.P[1]) or part.P[1]),
        round(my and (2 * py - part.P[2]) or part.P[2]),
        round(mz and (2 * pz - part.P[3]) or part.P[3]),
    }
    out.S = { part.S[1], part.S[2], part.S[3] }

    local r = euler_to_mat(math.rad(part.R[1]), math.rad(part.R[2]), math.rad(part.R[3]))
    local m = conjugate(r, mx and -1 or 1, my and -1 or 1, mz and -1 or 1)
    local ex, ey, ez = mat_to_euler(m)
    out.R = { round(math.deg(ex)), round(math.deg(ey)), round(math.deg(ez)) }

    if values.copy == false then out.Replace = true end

    return out
end

function plugin.preview(part, values)
    return flip(part, values)
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return flip(part, values)
end
