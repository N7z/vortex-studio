plugin = {
    name = "Sculpt",
    icon = Icons.Gem,
    ui = {
        { id = "model", type = "model", label = "Model", res = "res", solid = "solid" },
        { id = "res", type = "number", label = "Detail", default = 32 },
        { id = "size", type = "number", label = "Block size", default = 1 },
        { id = "solid", type = "checkbox", label = "Fill the inside", default = true },
        { id = "smooth", type = "number", label = "Smoothing", default = 2 },
        { id = "thick", type = "number", label = "Shell thickness", default = 0.6 },
        { id = "cover", type = "number", label = "Plate overlap", default = 1.5 },
        { id = "core", type = "checkbox", label = "Keep a solid core", default = true },
        { id = "flat", type = "number", label = "Keep flat faces square", default = 0.97 },
        { id = "ground", type = "checkbox", label = "Sit on the selected part", default = true },
        { id = "build", type = "button", label = "Sculpt model" },
    },
}

local MAX_VOXELS = 400000
local TO_DEG = 180 / math.pi

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

-- A part's local Y axis is column 1 of three.js' XYZ euler matrix, which for a zero
-- Y angle is (-sin rz, cos rx cos rz, sin rx cos rz). Solving that for the normal
-- leaves the roll about it free, and a square plate does not care which roll it gets.
local function euler_from_normal(nx, ny, nz)
    local rz = math.asin(clamp(-nx, -1, 1))
    local rx = math.atan(nz, ny)

    return round(rx * TO_DEG), 0, round(rz * TO_DEG)
end

local function build(part, values)
    if Model == nil or Model.count < 1 then return {} end
    if Model.count > MAX_VOXELS then
        error("that model has " .. Model.count .. " voxels, too many to sculpt: lower Detail")
    end

    local size = clamp(tonumber(values.size) or 1, 0.05, 50)
    local radius = math.floor(clamp(tonumber(values.smooth) or 2, 1, 3))
    local thick = clamp(tonumber(values.thick) or 0.6, 0.1, 2) * size
    local cover = clamp(tonumber(values.cover) or 1.5, 1, 3) * size
    local flat = clamp(tonumber(values.flat) or 0.97, 0, 1)
    local core = values.core ~= false
    local base = values.ground ~= false and (part.P[2] + part.S[2] / 2) or part.P[2]

    local W, D = Model.w, Model.d
    local ox = part.P[1] - W * size / 2
    local oz = part.P[3] - D * size / 2

    local solid = {}
    local xs, ys, zs, cs = {}, {}, {}, {}
    for i = 1, Model.count do
        local x, y, z, colour = Model.at(i)
        xs[i], ys[i], zs[i], cs[i] = x, y, z, colour
        solid[(y * D + z) * W + x] = true
    end

    local function filled(x, y, z)
        return solid[(y * D + z) * W + x] == true
    end

    -- Every empty cell in the neighbourhood pulls the normal towards itself, weighted
    -- by 1/distance^2, so the direction is the local surface's, not the voxel grid's.
    local offsets = {}
    for dx = -radius, radius do
        for dy = -radius, radius do
            for dz = -radius, radius do
                local d2 = dx * dx + dy * dy + dz * dz
                if d2 > 0 and d2 <= radius * radius + 0.001 then
                    offsets[#offsets + 1] = { dx, dy, dz, 1 / (d2 * math.sqrt(d2)) }
                end
            end
        end
    end

    local out = {}
    local limit = maxParts()

    for i = 1, Model.count do
        local x, y, z = xs[i], ys[i], zs[i]
        local buried = filled(x + 1, y, z) and filled(x - 1, y, z)
            and filled(x, y + 1, z) and filled(x, y - 1, z)
            and filled(x, y, z + 1) and filled(x, y, z - 1)

        if not buried then
            local nx, ny, nz = 0, 0, 0
            for k = 1, #offsets do
                local o = offsets[k]
                if not filled(x + o[1], y + o[2], z + o[3]) then
                    nx = nx + o[1] * o[4]
                    ny = ny + o[2] * o[4]
                    nz = nz + o[3] * o[4]
                end
            end

            local len = math.sqrt(nx * nx + ny * ny + nz * nz)
            if len > 1e-6 then
                nx, ny, nz = nx / len, ny / len, nz / len
                local cx = ox + (x + 0.5) * size
                local cy = base + (y + 0.5) * size
                local cz = oz + (z + 0.5) * size
                local biggest = math.max(math.abs(nx), math.abs(ny), math.abs(nz))

                if #out >= limit then return out end
                if biggest >= flat then
                    -- Square-on to an axis already: a plate here would only add seams.
                    out[#out + 1] = {
                        T = "Part",
                        P = { round(cx), round(cy), round(cz) },
                        S = { size, size, size },
                        R = { 0, 0, 0 },
                        C = cs[i],
                        Tr = 0,
                    }
                else
                    -- Pushed out along the normal so the plate's outer face lands where
                    -- the voxel's did, instead of sinking half a block into the model.
                    local push = (size - thick) / 2
                    local rx, ry, rz = euler_from_normal(nx, ny, nz)
                    out[#out + 1] = {
                        T = "Part",
                        P = {
                            round(cx + nx * push),
                            round(cy + ny * push),
                            round(cz + nz * push),
                        },
                        S = { round(cover), round(thick), round(cover) },
                        R = { rx, ry, rz },
                        C = cs[i],
                        Tr = 0,
                    }
                end
            end
        end
    end

    if not core then return out end

    -- What is left is entirely inside the shell, so it can be plain merged blocks.
    local i = 1
    while i <= Model.count do
        local x, y, z = xs[i], ys[i], zs[i]
        local buried = filled(x + 1, y, z) and filled(x - 1, y, z)
            and filled(x, y + 1, z) and filled(x, y - 1, z)
            and filled(x, y, z + 1) and filled(x, y, z - 1)
        if not buried then
            i = i + 1
        else
            local run = 1
            while i + run <= Model.count do
                local nx2, ny2, nz2 = xs[i + run], ys[i + run], zs[i + run]
                if ny2 ~= y or nz2 ~= z or nx2 ~= x + run or cs[i + run] ~= cs[i] then break end
                if not (filled(nx2 + 1, ny2, nz2) and filled(nx2 - 1, ny2, nz2)
                    and filled(nx2, ny2 + 1, nz2) and filled(nx2, ny2 - 1, nz2)
                    and filled(nx2, ny2, nz2 + 1) and filled(nx2, ny2, nz2 - 1)) then
                    break
                end
                run = run + 1
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
                C = cs[i],
                Tr = 0,
            }
            i = i + run
        end
    end

    return out
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return build(part, values)
end
