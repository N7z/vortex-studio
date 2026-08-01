plugin = {
    name = "Voxel",
    icon = Icons.Boxes,
    ui = {
        { id = "model", type = "model", label = "Model", res = "res", solid = "solid" },
        { id = "res", type = "number", label = "Detail", default = 32 },
        { id = "size", type = "number", label = "Block size", default = 1 },
        { id = "solid", type = "checkbox", label = "Fill the inside", default = false },
        { id = "merge", type = "checkbox", label = "Merge block runs", default = true },
        { id = "ground", type = "checkbox", label = "Sit on the selected part", default = true },
        { id = "build", type = "button", label = "Build model" },
    },
}

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

local function build(part, values)
    if Model == nil or Model.count < 1 then return {} end

    local size = clamp(tonumber(values.size) or 1, 0.05, 50)
    local merge = values.merge ~= false
    local base = values.ground ~= false and (part.P[2] + part.S[2] / 2) or part.P[2]
    local ox = part.P[1] - Model.w * size / 2
    local oz = part.P[3] - Model.d * size / 2

    local out = {}
    local i = 1
    while i <= Model.count do
        local x, y, z, colour = Model.at(i)
        local run = 1
        if merge then
            while i + run <= Model.count do
                local nx, ny, nz, nc = Model.at(i + run)
                if ny ~= y or nz ~= z or nc ~= colour or nx ~= x + run then break end
                run = run + 1
            end
        end
        if #out >= maxParts() then return out end
        out[#out + 1] = {
            T = "Part",
            P = {
                round(ox + (x + run / 2) * size),
                round(base + (y + 0.5) * size),
                round(oz + (z + 0.5) * size),
            },
            S = { round(run * size), round(size), round(size) },
            R = { 0, 0, 0 },
            C = colour,
            Tr = 0,
        }
        i = i + run
    end

    return out
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return build(part, values)
end
