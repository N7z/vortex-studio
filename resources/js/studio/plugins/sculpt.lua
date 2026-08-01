plugin = {
    name = "Sculpt",
    icon = Icons.Gem,
    ui = {
        { id = "model", type = "model", label = "Model", res = "res", solid = "solid" },
        { id = "res", type = "number", label = "Detail", default = 48 },
        { id = "size", type = "number", label = "Block size", default = 1 },
        { id = "solid", type = "checkbox", label = "Fill the inside", default = false },
        { id = "smooth", type = "number", label = "Smoothing", default = 2 },
        { id = "thick", type = "number", label = "Shell thickness", default = 0.5 },
        { id = "cover", type = "number", label = "Plate overlap", default = 1.7 },
        { id = "core", type = "checkbox", label = "Keep a solid core", default = false },
        { id = "flat", type = "number", label = "Keep flat faces square", default = 0.985 },
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
    local radius = math.floor(clamp(tonumber(values.smooth) or 2, 0, 4))
    local thick = clamp(tonumber(values.thick) or 0.5, 0.1, 2) * size
    local cover = clamp(tonumber(values.cover) or 1.7, 1, 4) * size
    local flat = clamp(tonumber(values.flat) or 0.985, 0, 1)
    local core = values.core == true
    local base = values.ground ~= false and (part.P[2] + part.S[2] / 2) or part.P[2]

    local W, D = Model.w, Model.d
    local ox = part.P[1] - W * size / 2
    local oz = part.P[3] - D * size / 2

    local slot = {}
    local xs, ys, zs, cs = {}, {}, {}, {}
    local nxs, nys, nzs = {}, {}, {}
    for i = 1, Model.count do
        local x, y, z, colour, nx, ny, nz = Model.at(i)
        xs[i], ys[i], zs[i], cs[i] = x, y, z, colour
        nxs[i], nys[i], nzs[i] = nx, ny, nz
        slot[(y * D + z) * W + x] = i
    end

    local function at(x, y, z)
        return slot[(y * D + z) * W + x]
    end

    -- The mesh's own normals are exact but carry the tessellation's jitter, so each
    -- one is averaged with its neighbours' inside a ball. Only neighbours already
    -- facing the same way join in: without that the average reaches across a thin
    -- wall or around a crease and tilts a plate into its own model.
    local AGREE = 0.4
    local ball = {}
    for dx = -radius, radius do
        for dy = -radius, radius do
            for dz = -radius, radius do
                local d2 = dx * dx + dy * dy + dz * dz
                if d2 <= radius * radius + 0.001 then
                    ball[#ball + 1] = { dx, dy, dz, 1 / (1 + d2) }
                end
            end
        end
    end

    local out = {}
    local limit = maxParts()

    for i = 1, Model.count do
        local x, y, z = xs[i], ys[i], zs[i]
        local buried = at(x + 1, y, z) and at(x - 1, y, z)
            and at(x, y + 1, z) and at(x, y - 1, z)
            and at(x, y, z + 1) and at(x, y, z - 1)

        if not buried then
            local ax, ay, az = nxs[i], nys[i], nzs[i]
            local nx, ny, nz = ax, ay, az
            if ax * ax + ay * ay + az * az > 0.01 then
                for k = 1, #ball do
                    local o = ball[k]
                    local j = at(x + o[1], y + o[2], z + o[3])
                    if j and j ~= i and nxs[j] * ax + nys[j] * ay + nzs[j] * az > AGREE then
                        nx = nx + nxs[j] * o[4]
                        ny = ny + nys[j] * o[4]
                        nz = nz + nzs[j] * o[4]
                    end
                end
            end

            local len = math.sqrt(nx * nx + ny * ny + nz * nz)
            -- No mesh normal here, or the neighbourhood cancelled out: fall back to
            -- which way the empty space lies, which is all a filled cell can say.
            if len < 0.05 then
                nx, ny, nz = 0, 0, 0
                for k = 1, #ball do
                    local o = ball[k]
                    if not at(x + o[1], y + o[2], z + o[3]) then
                        nx = nx + o[1] * o[4]
                        ny = ny + o[2] * o[4]
                        nz = nz + o[3] * o[4]
                    end
                end
                len = math.sqrt(nx * nx + ny * ny + nz * nz)
            end

            if len > 1e-6 then
                nx, ny, nz = nx / len, ny / len, nz / len
                local cx = ox + (x + 0.5) * size
                local cy = base + (y + 0.5) * size
                local cz = oz + (z + 0.5) * size

                if #out >= limit then return out end
                if math.max(math.abs(nx), math.abs(ny), math.abs(nz)) >= flat then
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
        local function buried_at(j)
            local bx, by, bz = xs[j], ys[j], zs[j]
            return at(bx + 1, by, bz) and at(bx - 1, by, bz)
                and at(bx, by + 1, bz) and at(bx, by - 1, bz)
                and at(bx, by, bz + 1) and at(bx, by, bz - 1)
        end
        if not buried_at(i) then
            i = i + 1
        else
            local run = 1
            while i + run <= Model.count do
                local j = i + run
                if ys[j] ~= y or zs[j] ~= z or xs[j] ~= x + run or cs[j] ~= cs[i] then break end
                if not buried_at(j) then break end
                run = run + 1
            end
            if #out >= limit then return out end
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
