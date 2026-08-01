plugin = {
    name = "Array",
    version = "1.0",
    icon = Icons.Grid3x3,
    ui = {
        { id = "copies", type = "number", label = "Copies", default = 4 },
        { id = "stepx", type = "number", label = "Step X", default = 6 },
        { id = "stepy", type = "number", label = "Step Y", default = 0 },
        { id = "stepz", type = "number", label = "Step Z", default = 0 },
        { id = "spin", type = "number", label = "Turn Y", default = 0 },
        { id = "grow", type = "number", label = "Grow %", default = 0 },
        { id = "radial", type = "checkbox", label = "Ring instead of line", default = false },
        { id = "radius", type = "number", label = "Ring radius", default = 12 },
        { id = "arc", type = "number", label = "Ring arc", default = 360 },
        { id = "face", type = "checkbox", label = "Turn to face the ring", default = true },
        { id = "build", type = "button", label = "Build array" },
    },
}

local MAX_COPIES = 512

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

local function copy_of(part)
    local out = {}
    for k, v in pairs(part) do
        out[k] = v
    end
    return out
end

local function ring_step(copies, arc)
    if math.abs(arc) >= 360 then return arc / (copies + 1) end
    return arc / copies
end

local function nth(part, values, i)
    local out = copy_of(part)
    local scale = 1 + (tonumber(values.grow) or 0) / 100 * i
    if scale < 0.01 then scale = 0.01 end
    out.S = { round(part.S[1] * scale), round(part.S[2] * scale), round(part.S[3] * scale) }

    if values.radial then
        local copies = clamp(math.floor(tonumber(values.copies) or 0), 1, MAX_COPIES)
        local radius = tonumber(values.radius) or 0
        local step = ring_step(copies, tonumber(values.arc) or 360)
        local cx = part.P[1] + radius
        local cz = part.P[3]
        local a = math.rad(180 + step * i)
        out.P = {
            round(cx + radius * math.cos(a)),
            round(part.P[2] + (tonumber(values.stepy) or 0) * i),
            round(cz + radius * math.sin(a)),
        }
        local turn = values.face and step * i or 0
        out.R = { part.R[1], round(part.R[2] + turn + (tonumber(values.spin) or 0) * i), part.R[3] }
        return out
    end

    out.P = {
        round(part.P[1] + (tonumber(values.stepx) or 0) * i),
        round(part.P[2] + (tonumber(values.stepy) or 0) * i),
        round(part.P[3] + (tonumber(values.stepz) or 0) * i),
    }
    out.R = { part.R[1], round(part.R[2] + (tonumber(values.spin) or 0) * i), part.R[3] }
    return out
end

local function series(part, values)
    local copies = clamp(math.floor(tonumber(values.copies) or 0), 0, MAX_COPIES)
    local out = {}
    for i = 1, copies do
        out[#out + 1] = nth(part, values, i)
    end
    return out
end

function plugin.preview(part, values)
    return series(part, values)
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return series(part, values)
end
