plugin = {
    name = "Image Maker",
    icon = Icons.Image,
    ui = {
        { id = "img", type = "image", label = "Image" },
        { id = "pixels", type = "number", label = "Pixels", default = 32 },
        { id = "size", type = "number", label = "Size", default = 1 },
        { id = "depth", type = "number", label = "Depth", default = 1 },
        { id = "flat", type = "checkbox", label = "Lay flat on the ground", default = false },
        { id = "merge", type = "checkbox", label = "Merge same-colour areas", default = true },
        { id = "build", type = "button", label = "Build pixel art" },
    },
}

local MAX_PIXELS = 96
local ALPHA_CUT = 128

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

local function raster(cols, rows)
    local grid = {}
    for row = 0, rows - 1 do
        local line = {}
        local sy = math.floor((row + 0.5) * Image.h / rows)
        for col = 0, cols - 1 do
            local sx = math.floor((col + 0.5) * Image.w / cols)
            local hex, a = Image.pixel(sx, sy)
            line[col + 1] = (hex and a >= ALPHA_CUT) and hex or nil
        end
        grid[row + 1] = line
    end
    return grid
end

local function build(part, values)
    if Image == nil then return nil end

    local cols = math.floor(clamp(values.pixels, 1, MAX_PIXELS))
    local rows = math.max(1, math.floor(cols * Image.h / Image.w + 0.5))
    local size = clamp(values.size, 0.05, 100)
    local depth = clamp(values.depth, 0.05, 100)
    local flat = values.flat and true or false
    local merge = values.merge ~= false

    local grid = raster(cols, rows)

    local ax, ay, az = part.P[1], part.P[2], part.P[3]
    local left = ax - cols * size / 2
    local back = az - rows * size / 2

    local out = {}
    local used = {}
    for row = 1, rows do used[row] = {} end

    for row = 1, rows do
        for col = 1, cols do
            local hex = grid[row][col]
            if hex ~= nil and not used[row][col] then
                local w = 1
                if merge then
                    while col + w <= cols
                        and grid[row][col + w] == hex
                        and not used[row][col + w] do
                        w = w + 1
                    end
                end
                local h = 1
                if merge then
                    local grow = true
                    while grow and row + h <= rows do
                        for k = col, col + w - 1 do
                            if grid[row + h][k] ~= hex or used[row + h][k] then
                                grow = false
                                break
                            end
                        end
                        if grow then h = h + 1 end
                    end
                end
                for r = row, row + h - 1 do
                    for k = col, col + w - 1 do used[r][k] = true end
                end

                local cx = left + (col - 1 + w / 2) * size
                local p, s
                if flat then
                    p = { cx, ay, back + (row - 1 + h / 2) * size }
                    s = { w * size, depth, h * size }
                else
                    p = { cx, ay + (rows - row + 1 - h / 2) * size, az }
                    s = { w * size, h * size, depth }
                end
                out[#out + 1] = {
                    Tr = 0,
                    P = { round(p[1]), round(p[2]), round(p[3]) },
                    S = { round(s[1]), round(s[2]), round(s[3]) },
                    R = { 0, 0, 0 },
                    T = "Part",
                    Shape = "Block",
                    C = hex,
                }
            end
        end
    end
    return out
end

local function extent(part, values)
    if Image == nil then return nil end
    local cols = math.floor(clamp(values.pixels, 1, MAX_PIXELS))
    local rows = math.max(1, math.floor(cols * Image.h / Image.w + 0.5))
    local size = clamp(values.size, 0.05, 100)
    local depth = clamp(values.depth, 0.05, 100)
    local w, h = cols * size, rows * size
    local ax, ay, az = part.P[1], part.P[2], part.P[3]

    local p, s
    if values.flat then
        p = { ax, ay, az }
        s = { w, depth, h }
    else
        p = { ax, ay + h / 2, az }
        s = { w, h, depth }
    end
    return {
        Tr = 0,
        P = { round(p[1]), round(p[2]), round(p[3]) },
        S = { round(s[1]), round(s[2]), round(s[3]) },
        R = { 0, 0, 0 },
        T = "Part",
        Shape = "Block",
        C = "ffffff",
    }
end

function plugin.preview(part, values)
    return extent(part, values)
end

function plugin.click(id, part, values)
    if id == "build" then
        return build(part, values)
    end
end
