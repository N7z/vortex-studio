plugin = {
    name = "Text",
    icon = Icons.Type,
    ui = {
        { id = "text", type = "text", label = "Text", default = "VORTEX" },
        { id = "size", type = "number", label = "Pixel size", default = 1 },
        { id = "depth", type = "number", label = "Depth", default = 1 },
        { id = "gap", type = "number", label = "Letter gap", default = 1 },
        { id = "flat", type = "checkbox", label = "Lay flat on the ground", default = false },
        { id = "merge", type = "checkbox", label = "Merge pixel runs", default = true },
        { id = "build", type = "button", label = "Build text" },
    },
}

local ROWS = 7
local COLS = 5
local MAX_PARTS = 3000

local FONT = {
    A = "01110,10001,10001,11111,10001,10001,10001",
    B = "11110,10001,10001,11110,10001,10001,11110",
    C = "01110,10001,10000,10000,10000,10001,01110",
    D = "11110,10001,10001,10001,10001,10001,11110",
    E = "11111,10000,10000,11110,10000,10000,11111",
    F = "11111,10000,10000,11110,10000,10000,10000",
    G = "01110,10001,10000,10111,10001,10001,01111",
    H = "10001,10001,10001,11111,10001,10001,10001",
    I = "11111,00100,00100,00100,00100,00100,11111",
    J = "00111,00010,00010,00010,00010,10010,01100",
    K = "10001,10010,10100,11000,10100,10010,10001",
    L = "10000,10000,10000,10000,10000,10000,11111",
    M = "10001,11011,10101,10101,10001,10001,10001",
    N = "10001,11001,10101,10011,10001,10001,10001",
    O = "01110,10001,10001,10001,10001,10001,01110",
    P = "11110,10001,10001,11110,10000,10000,10000",
    Q = "01110,10001,10001,10001,10101,10010,01101",
    R = "11110,10001,10001,11110,10100,10010,10001",
    S = "01111,10000,10000,01110,00001,00001,11110",
    T = "11111,00100,00100,00100,00100,00100,00100",
    U = "10001,10001,10001,10001,10001,10001,01110",
    V = "10001,10001,10001,10001,10001,01010,00100",
    W = "10001,10001,10001,10101,10101,10101,01010",
    X = "10001,10001,01010,00100,01010,10001,10001",
    Y = "10001,10001,01010,00100,00100,00100,00100",
    Z = "11111,00001,00010,00100,01000,10000,11111",
    ["0"] = "01110,10001,10011,10101,11001,10001,01110",
    ["1"] = "00100,01100,00100,00100,00100,00100,01110",
    ["2"] = "01110,10001,00001,00010,00100,01000,11111",
    ["3"] = "11111,00010,00100,00010,00001,10001,01110",
    ["4"] = "00010,00110,01010,10010,11111,00010,00010",
    ["5"] = "11111,10000,11110,00001,00001,10001,01110",
    ["6"] = "00110,01000,10000,11110,10001,10001,01110",
    ["7"] = "11111,00001,00010,00100,01000,01000,01000",
    ["8"] = "01110,10001,10001,01110,10001,10001,01110",
    ["9"] = "01110,10001,10001,01111,00001,00010,01100",
    ["."] = "00000,00000,00000,00000,00000,01100,01100",
    [","] = "00000,00000,00000,00000,01100,01100,11000",
    ["!"] = "00100,00100,00100,00100,00100,00000,00100",
    ["?"] = "01110,10001,00001,00010,00100,00000,00100",
    ["-"] = "00000,00000,00000,11111,00000,00000,00000",
    ["+"] = "00000,00100,00100,11111,00100,00100,00000",
    [":"] = "00000,01100,01100,00000,01100,01100,00000",
    ["'"] = "00100,00100,01000,00000,00000,00000,00000",
    ["/"] = "00001,00010,00010,00100,01000,01000,10000",
    ["("] = "00010,00100,01000,01000,01000,00100,00010",
    [")"] = "01000,00100,00010,00010,00010,00100,01000",
    ["*"] = "00000,10101,01110,11111,01110,10101,00000",
    ["="] = "00000,00000,11111,00000,11111,00000,00000",
    ["#"] = "01010,01010,11111,01010,11111,01010,01010",
}

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

local function glyph(ch)
    if ch == " " then return nil end
    local rows = FONT[ch] or FONT[ch:upper()]
    if not rows then return nil end
    local out = {}
    local i = 1
    for line in rows:gmatch("[^,]+") do
        out[i] = line
        i = i + 1
    end
    return out
end

local function lit(rows, row, col)
    if not rows then return false end
    local line = rows[row]
    if not line then return false end
    return line:sub(col, col) == "1"
end

local function build(part, values)
    local text = tostring(values.text or "")
    if text == "" then return {} end

    local size = clamp(tonumber(values.size) or 1, 0.05, 50)
    local depth = clamp(tonumber(values.depth) or 1, 0.05, 50)
    local gap = clamp(math.floor(tonumber(values.gap) or 1), 0, 10)
    local merge = values.merge ~= false
    local flat = values.flat == true

    local color = part.C or "a3a2a5"
    local shape = part.Shape or part.Sh
    local ox, oy, oz = part.P[1], part.P[2], part.P[3]
    local out = {}

    local pen = 0
    for n = 1, #text do
        local ch = text:sub(n, n)
        local rows = glyph(ch)
        if ch == " " then
            pen = pen + COLS + gap
        elseif rows then
            for r = 1, ROWS do
                local c = 1
                while c <= COLS do
                    if lit(rows, r, c) then
                        local run = 1
                        if merge then
                            while c + run <= COLS and lit(rows, r, c + run) do run = run + 1 end
                        end
                        if #out >= MAX_PARTS then return out end
                        local cx = (pen + c - 1 + run / 2) * size
                        local cy = (ROWS - r + 0.5) * size
                        local p
                        if flat then
                            p = { round(ox + cx), round(oy), round(oz - cy) }
                        else
                            p = { round(ox + cx), round(oy + cy), round(oz) }
                        end
                        local s
                        if flat then
                            s = { round(run * size), round(depth), round(size) }
                        else
                            s = { round(run * size), round(size), round(depth) }
                        end
                        out[#out + 1] = {
                            T = part.T or "Part",
                            Shape = shape,
                            P = p,
                            S = s,
                            R = { 0, 0, 0 },
                            C = color,
                            Tr = part.Tr or 0,
                        }
                        c = c + run
                    else
                        c = c + 1
                    end
                end
            end
            pen = pen + COLS + gap
        end
    end

    return out
end

function plugin.click(id, part, values)
    if id ~= "build" then return nil end
    return build(part, values)
end
