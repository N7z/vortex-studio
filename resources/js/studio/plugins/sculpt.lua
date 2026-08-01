plugin = {
    name = "Sculpt",
    icon = Icons.Gem,
    ui = {
        { id = "model", type = "model", label = "Model", res = "res", solid = "solid" },
        { id = "res", type = "number", label = "Detail", default = 48 },
        { id = "size", type = "number", label = "Block size", default = 1 },
        { id = "solid", type = "checkbox", label = "Fill the inside", default = false },
        { id = "smooth", type = "number", label = "Smoothing", default = 2 },
        { id = "merge", type = "number", label = "Merge angle", default = 6 },
        { id = "thick", type = "number", label = "Shell thickness", default = 0.5 },
        { id = "cover", type = "number", label = "Plate overlap", default = 1.7 },
        { id = "core", type = "checkbox", label = "Keep a solid core", default = false },
        { id = "flat", type = "number", label = "Keep flat faces square", default = 0.985 },
        { id = "ground", type = "checkbox", label = "Sit on the selected part", default = true },
        { id = "build", type = "button", label = "Sculpt model" },
    },
}

local MAX_VOXELS = 400000
local MAX_RUN = 64
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

-- Euler XYZ from the three local axes, which are the columns of the rotation matrix.
-- Inverted from three.js' own makeRotationFromEuler, so a part wears exactly the
-- orientation asked for: local Y along the normal, local X along the run.
local function euler_from_axes(xx, _, _, yx, yy, yz, zx, zy, zz)
    local ry = math.asin(clamp(zx, -1, 1))
    local rx, rz
    if math.abs(zx) < 0.9999999 then
        rx = math.atan(-zy, zz)
        rz = math.atan(-yx, xx)
    else
        rx = math.atan(yz, yy)
        rz = 0
    end

    return round(rx * TO_DEG), round(ry * TO_DEG), round(rz * TO_DEG)
end

-- `counting` swaps the emit for a tally down the one code path, so what the panel
-- promises and what the button makes can never drift apart.
local function build(part, values, counting)
    if Model == nil or Model.count < 1 then return counting and 0 or {} end
    if Model.count > MAX_VOXELS then
        error("that model has " .. Model.count .. " voxels, too many to sculpt: lower Detail")
    end

    local size = clamp(tonumber(values.size) or 1, 0.05, 50)
    local radius = math.floor(clamp(tonumber(values.smooth) or 2, 0, 4))
    local thick = clamp(tonumber(values.thick) or 0.5, 0.1, 2) * size
    local cover = clamp(tonumber(values.cover) or 1.7, 1, 4) * size
    local flat = clamp(tonumber(values.flat) or 0.985, 0, 1)
    local merge = clamp(tonumber(values.merge) or 6, 0, 45)
    local agree = merge > 0 and math.cos(merge / TO_DEG) or 2
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

    local skin, sx, sy, sz = {}, {}, {}, {}
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
                skin[i] = true
                sx[i], sy[i], sz[i] = nx / len, ny / len, nz / len
            end
        end
    end

    local function is_flat(i)
        return math.max(math.abs(sx[i]), math.abs(sy[i]), math.abs(sz[i])) >= flat
    end

    local out = {}
    local made = 0
    local limit = maxParts()
    local taken = {}
    local function emit(p)
        made = made + 1
        if not counting then out[#out + 1] = p end
    end
    local function done()
        if counting then return made end
        return out
    end

    for i = 1, Model.count do
        if skin[i] and not taken[i] then
            local nx, ny, nz = sx[i], sy[i], sz[i]
            local square = is_flat(i)

            -- Run along the world axis the plate is most face-on to, so each step is
            -- across the plate rather than into it and the tangent cannot degenerate.
            local ax, ay, az = 0, 0, 0
            local bx, by, bz = math.abs(nx), math.abs(ny), math.abs(nz)
            if bx <= by and bx <= bz then ax = 1
            elseif by <= bz then ay = 1
            else az = 1 end

            local run, last = 1, i
            if merge > 0 then
                while run < MAX_RUN do
                    local j = at(xs[i] + ax * run, ys[i] + ay * run, zs[i] + az * run)
                    if not (j and skin[j] and not taken[j] and cs[j] == cs[i]) then break end
                    if sx[j] * nx + sy[j] * ny + sz[j] * nz < agree then break end
                    if is_flat(j) ~= square then break end
                    last = j
                    run = run + 1
                end
            end
            for k = 0, run - 1 do
                taken[at(xs[i] + ax * k, ys[i] + ay * k, zs[i] + az * k)] = true
            end

            -- Halfway between the ends, which is the run's middle cell centre.
            local cx = ox + ((xs[i] + xs[last]) / 2 + 0.5) * size
            local cy = base + ((ys[i] + ys[last]) / 2 + 0.5) * size
            local cz = oz + ((zs[i] + zs[last]) / 2 + 0.5) * size

            if made >= limit then return done() end
            if square then
                -- Square-on to an axis already: a plate here would only add seams.
                emit({
                    T = "Part",
                    P = { round(cx), round(cy), round(cz) },
                    S = {
                        round(size + ax * (run - 1) * size),
                        round(size + ay * (run - 1) * size),
                        round(size + az * (run - 1) * size),
                    },
                    R = { 0, 0, 0 },
                    C = cs[i],
                    Tr = 0,
                })
            else
                local d = ax * nx + ay * ny + az * nz
                local tx, ty, tz = ax - d * nx, ay - d * ny, az - d * nz
                local tl = math.sqrt(tx * tx + ty * ty + tz * tz)
                tx, ty, tz = tx / tl, ty / tl, tz / tl
                local ux = ty * nz - tz * ny
                local uy = tz * nx - tx * nz
                local uz = tx * ny - ty * nx
                local rx, ry, rz = euler_from_axes(tx, ty, tz, nx, ny, nz, ux, uy, uz)

                -- Pushed out along the normal so the plate's outer face lands where
                -- the voxel's did, instead of sinking half a block into the model.
                local push = (size - thick) / 2
                emit({
                    T = "Part",
                    P = {
                        round(cx + nx * push),
                        round(cy + ny * push),
                        round(cz + nz * push),
                    },
                    S = { round((run - 1) * size + cover), round(thick), round(cover) },
                    R = { rx, ry, rz },
                    C = cs[i],
                    Tr = 0,
                })
            end
        end
    end

    if not core then return done() end

    -- What is left is entirely inside the shell, so it can be plain merged blocks.
    local i = 1
    while i <= Model.count do
        if skin[i] then
            i = i + 1
        else
            local x, y, z = xs[i], ys[i], zs[i]
            local run = 1
            while i + run <= Model.count do
                local j = i + run
                if ys[j] ~= y or zs[j] ~= z or xs[j] ~= x + run or cs[j] ~= cs[i] then break end
                if skin[j] then break end
                run = run + 1
            end
            if made >= limit then return done() end
            emit({
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
            })
            i = i + run
        end
    end

    return done()
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return build(part, values)
end

function plugin.count(part, values)
    return build(part, values, true)
end
