json = {}

local decode_value

local function skip_ws(s, i)
    local j = s:find('[^ \t\r\n]', i)
    return j or (#s + 1)
end

local function decode_string(s, i)
    local out, j = {}, i + 1
    local esc = { n = '\n', t = '\t', r = '\r', b = '\b', f = '\f', ['"'] = '"', ['\\'] = '\\', ['/'] = '/' }
    while j <= #s do
        local c = s:sub(j, j)
        if c == '"' then
            return table.concat(out), j + 1
        elseif c == '\\' then
            local e = s:sub(j + 1, j + 1)
            if e == 'u' then
                out[#out + 1] = utf8.char(tonumber(s:sub(j + 2, j + 5), 16))
                j = j + 6
            else
                out[#out + 1] = esc[e] or e
                j = j + 2
            end
        else
            out[#out + 1] = c
            j = j + 1
        end
    end
    error('unterminated string')
end

local function decode_number(s, i)
    local num = s:match('^-?%d+%.?%d*[eE]?[+-]?%d*', i)
    return tonumber(num), i + #num
end

local function decode_array(s, i)
    local out, j = {}, skip_ws(s, i + 1)
    if s:sub(j, j) == ']' then return out, j + 1 end
    while true do
        local v
        v, j = decode_value(s, j)
        out[#out + 1] = v
        j = skip_ws(s, j)
        local c = s:sub(j, j)
        if c == ']' then return out, j + 1 end
        if c ~= ',' then error('bad array') end
        j = skip_ws(s, j + 1)
    end
end

local function decode_object(s, i)
    local out, j = {}, skip_ws(s, i + 1)
    if s:sub(j, j) == '}' then return out, j + 1 end
    while true do
        if s:sub(j, j) ~= '"' then error('bad object key') end
        local k, v
        k, j = decode_string(s, j)
        j = skip_ws(s, j)
        if s:sub(j, j) ~= ':' then error('bad object') end
        v, j = decode_value(s, skip_ws(s, j + 1))
        out[k] = v
        j = skip_ws(s, j)
        local c = s:sub(j, j)
        if c == '}' then return out, j + 1 end
        if c ~= ',' then error('bad object') end
        j = skip_ws(s, j + 1)
    end
end

decode_value = function(s, i)
    i = skip_ws(s, i)
    local c = s:sub(i, i)
    if c == '"' then return decode_string(s, i) end
    if c == '{' then return decode_object(s, i) end
    if c == '[' then return decode_array(s, i) end
    if c == 't' and s:sub(i, i + 3) == 'true' then return true, i + 4 end
    if c == 'f' and s:sub(i, i + 4) == 'false' then return false, i + 5 end
    if c == 'n' and s:sub(i, i + 3) == 'null' then return nil, i + 4 end
    return decode_number(s, i)
end

function json.decode(s)
    local v = decode_value(s, 1)
    return v
end

Icons = setmetatable({}, { __index = function(_, key) return key end })

Image = nil

local function enc_opts(opts)
    if opts == nil then return '' end
    local out = {}
    for k, v in pairs(opts) do
        if type(v) == 'boolean' then
            out[#out + 1] = k .. '=' .. (v and 'true' or 'false')
        elseif type(v) == 'number' or type(v) == 'string' then
            out[#out + 1] = k .. '=' .. tostring(v)
        end
    end
    return table.concat(out, ';')
end

local function split_hex(s)
    if s == nil or s == '' then return nil, 0 end
    local a = tonumber(s:sub(7, 8), 16) or 255
    if a == 0 then return nil, 0 end
    return s:sub(1, 6), a
end

function __set_image(w, h)
    if w == nil or h == nil or w < 1 or h < 1 then
        Image = nil
        return
    end
    local img = { w = math.floor(w), h = math.floor(h) }

    function img.pixel(x, y)
        return split_hex(__img_px(math.floor(x), math.floor(y)))
    end

    function img.rgb(x, y)
        local s = __img_px(math.floor(x), math.floor(y))
        if s == nil or s == '' then return nil end
        return tonumber(s:sub(1, 2), 16), tonumber(s:sub(3, 4), 16),
            tonumber(s:sub(5, 6), 16), tonumber(s:sub(7, 8), 16)
    end

    function img.box(x0, y0, x1, y1)
        return split_hex(__img_box(x0, y0, x1, y1))
    end

    function img.aspect(opts)
        local s = __img_aspect(enc_opts(opts))
        if s == nil or s == '' then return img.w, img.h end
        local a, b = s:match('^(%d+),(%d+)$')
        return tonumber(a) or img.w, tonumber(b) or img.h
    end

    function img.grid(cols, opts)
        local s = __img_grid(math.floor(cols), enc_opts(opts))
        if s == nil or s == '' then return nil end
        local c, r, data = s:match('^(%d+),(%d+),(.*)$')
        c, r = tonumber(c), tonumber(r)
        if c == nil or r == nil then return nil end
        local g = { cols = c, rows = r }
        function g.get(col, row)
            if col < 1 or row < 1 or col > c or row > r then return nil, 0 end
            local i = ((row - 1) * c + (col - 1)) * 8 + 1
            return split_hex(data:sub(i, i + 7))
        end
        return g
    end

    Image = img
end

Selection = nil

function __set_selection(info_json)
    if info_json == nil or info_json == '' then
        Selection = nil
        return
    end
    Selection = json.decode(info_json)
end

Model = nil

function __set_model(w, h, d, count, data)
    if data == nil or data == '' or count == nil or count < 1 then
        Model = nil
        return
    end
    local m = { w = math.floor(w), h = math.floor(h), d = math.floor(d), count = math.floor(count) }
    function m.at(i)
        if i < 1 or i > m.count then return nil end
        local o = (i - 1) * 12
        return tonumber(data:sub(o + 1, o + 2), 16),
            tonumber(data:sub(o + 3, o + 4), 16),
            tonumber(data:sub(o + 5, o + 6), 16),
            data:sub(o + 7, o + 12)
    end
    Model = m
end

function __preview(part_json, values_json)
    if plugin == nil or plugin.preview == nil then return nil end
    return plugin.preview(json.decode(part_json), json.decode(values_json))
end

function __click(id, part_json, values_json)
    if plugin == nil or plugin.click == nil then return nil end
    return plugin.click(id, json.decode(part_json), json.decode(values_json))
end
