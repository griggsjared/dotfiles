local M = {}

---@param hex string
---@return table {r: number, g: number, b: number}
local function hex_to_rgb(hex)
  if hex == nil then
    return { r = 0, g = 0, b = 0 }
  end
  hex = string.lower(hex)
  return {
    r = tonumber(hex:sub(2, 3), 16),
    g = tonumber(hex:sub(4, 5), 16),
    b = tonumber(hex:sub(6, 7), 16),
  }
end

---@param rgb table {r: number, g: number, b: number}
---@return string Hex color
local function rgb_to_hex(rgb)
  local red = string.format("%02x", rgb.r)
  local green = string.format("%02x", rgb.g)
  local blue = string.format("%02x", rgb.b)
  return "#" .. red .. green .. blue
end

---@param hex string Hex color
---@param amt number Amount to lighten (0-255)
---@return string Lightened hex color
function M.lighten(hex, amt)
  if hex == "NONE" then
    return hex
  end

  local rgb = hex_to_rgb(hex)
  -- Bound to upper limit
  rgb.r = (rgb.r + amt > 255) and 255 or (rgb.r + amt)
  rgb.g = (rgb.g + amt > 255) and 255 or (rgb.g + amt)
  rgb.b = (rgb.b + amt > 255) and 255 or (rgb.b + amt)
  -- Bound to lower limit
  rgb.r = (rgb.r < 0) and 0 or rgb.r
  rgb.g = (rgb.g < 0) and 0 or rgb.g
  rgb.b = (rgb.b < 0) and 0 or rgb.b

  return rgb_to_hex(rgb)
end

---@param hex string Hex color
---@param percent number Percentage to lighten (0-100)
---@return string Lightened hex color
function M.lighten_percent(hex, percent)
  if hex == "NONE" then
    return hex
  end

  local rgb = hex_to_rgb(hex)
  -- Lighten by percentage of remaining distance to white (255)
  -- Formula: new = old + (255 - old) * percent / 100
  rgb.r = math.floor(rgb.r + (255 - rgb.r) * percent / 100)
  rgb.g = math.floor(rgb.g + (255 - rgb.g) * percent / 100)
  rgb.b = math.floor(rgb.b + (255 - rgb.b) * percent / 100)
  -- Bound to upper limit
  rgb.r = (rgb.r > 255) and 255 or rgb.r
  rgb.g = (rgb.g > 255) and 255 or rgb.g
  rgb.b = (rgb.b > 255) and 255 or rgb.b

  return rgb_to_hex(rgb)
end

---@param red number Red component (0-255)
---@param green number Green component (0-255)
---@param blue number Blue component (0-255)
---@param alpha number Alpha/opacity (0.0-1.0)
---@param background string Background hex color (required)
---@return string Blended hex color
function M.rgba(red, green, blue, alpha, background)
  if background == nil or background == "NONE" then
    error("rgba: background color is required and cannot be NONE")
  end

  local bg_rgb = hex_to_rgb(background)
  -- Blend foreground with background based on alpha
  red = (1 - alpha) * bg_rgb.r + alpha * red
  green = (1 - alpha) * bg_rgb.g + alpha * green
  blue = (1 - alpha) * bg_rgb.b + alpha * blue

  return rgb_to_hex({ r = red, g = green, b = blue })
end

---@param hex string Hex color to blend
---@param alpha number Alpha/opacity (0.0-1.0)
---@param base string Base color (required)
---@return string Blended hex color
function M.blend(hex, alpha, base)
  if hex == "NONE" then
    return "NONE"
  end

  if base == nil or base == "NONE" then
    error("blend: base color is required and cannot be NONE")
  end

  local rgb = hex_to_rgb(hex)
  return M.rgba(rgb.r, rgb.g, rgb.b, alpha, base)
end

return M
