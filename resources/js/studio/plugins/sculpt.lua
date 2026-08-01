plugin = {
    name = "Model",
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
        { id = "build", type = "button", label = "Build model" },
    },
}

local MAX_VOXELS = 400000
local MAX_RUN = 64
local TO_DEG = 180 / math.pi
local AGREE = 0.4

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

local cache = {}

local function prepared(radius)
    if cache.model == Model and cache.radius == radius then return cache end

    local W, D = Model.w, Model.d
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

    cache = {
        model = Model, radius = radius, at = at, counts = {},
        xs = xs, ys = ys, zs = zs, cs = cs,
        skin = skin, sx = sx, sy = sy, sz = sz,
    }

    return cache
end

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

    local c = prepared(radius)
    local xs, ys, zs, cs = c.xs, c.ys, c.zs, c.cs
    local skin, sx, sy, sz = c.skin, c.sx, c.sy, c.sz
    local at = c.at

    local key = flat .. "/" .. merge .. "/" .. tostring(core)
    if counting and c.counts[key] then return c.counts[key] end

    local W, D = Model.w, Model.d
    local ox = part.P[1] - W * size / 2
    local oz = part.P[3] - D * size / 2

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
        if not counting then return out end
        c.counts[key] = made

        return made
    end

    for i = 1, Model.count do
        if skin[i] and not taken[i] then
            local nx, ny, nz = sx[i], sy[i], sz[i]
            local square = is_flat(i)

            local anx, any, anz = math.abs(nx), math.abs(ny), math.abs(nz)
            local ax, ay, az = 0, 0, 0
            local bx, by, bz = 0, 0, 0
            if anx <= any and anx <= anz then
                ax = 1
                if any <= anz then by = 1 else bz = 1 end
            elseif any <= anz then
                ay = 1
                if anx <= anz then bx = 1 else bz = 1 end
            else
                az = 1
                if anx <= any then bx = 1 else by = 1 end
            end

            local x0, y0, z0 = xs[i], ys[i], zs[i]
            local function fits(j)
                return j and skin[j] and not taken[j] and cs[j] == cs[i]
                    and sx[j] * nx + sy[j] * ny + sz[j] * nz >= agree
                    and is_flat(j) == square
            end

            local run = 1
            while run < MAX_RUN and fits(at(x0 + ax * run, y0 + ay * run, z0 + az * run)) do
                run = run + 1
            end

            local rows = 1
            while rows < MAX_RUN do
                local whole = true
                for k = 0, run - 1 do
                    if not fits(at(x0 + ax * k + bx * rows, y0 + ay * k + by * rows,
                        z0 + az * k + bz * rows)) then
                        whole = false
                        break
                    end
                end
                if not whole then break end
                rows = rows + 1
            end

            for r = 0, rows - 1 do
                for k = 0, run - 1 do
                    taken[at(x0 + ax * k + bx * r, y0 + ay * k + by * r, z0 + az * k + bz * r)] = true
                end
            end

            local spanA, spanB = run - 1, rows - 1
            local cx = ox + (x0 + (ax * spanA + bx * spanB) / 2 + 0.5) * size
            local cy = base + (y0 + (ay * spanA + by * spanB) / 2 + 0.5) * size
            local cz = oz + (z0 + (az * spanA + bz * spanB) / 2 + 0.5) * size

            if made >= limit then return done() end
            if square then
                emit({
                    T = "Part",
                    P = { round(cx), round(cy), round(cz) },
                    S = {
                        round(size * (1 + ax * spanA + bx * spanB)),
                        round(size * (1 + ay * spanA + by * spanB)),
                        round(size * (1 + az * spanA + bz * spanB)),
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

                local push = (size - thick) / 2
                emit({
                    T = "Part",
                    P = {
                        round(cx + nx * push),
                        round(cy + ny * push),
                        round(cz + nz * push),
                    },
                    S = { round(spanA * size + cover), round(thick), round(spanB * size + cover) },
                    R = { rx, ry, rz },
                    C = cs[i],
                    Tr = 0,
                })
            end
        end
    end

    if not core then return done() end

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

function plugin.count(values)
    return build({ P = { 0, 0, 0 }, S = { 0, 0, 0 } }, values, true)
end
