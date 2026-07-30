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

function __set_image(w, h, data)
    if data == nil or data == '' or w == nil or w < 1 or h < 1 then
        Image = nil
        return
    end
    local img = { w = math.floor(w), h = math.floor(h), data = data }
    function img.pixel(x, y)
        x, y = math.floor(x), math.floor(y)
        if x < 0 or y < 0 or x >= img.w or y >= img.h then return nil, 0 end
        local i = (y * img.w + x) * 8 + 1
        return data:sub(i, i + 5), tonumber(data:sub(i + 6, i + 7), 16) or 255
    end
    Image = img
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
