-- Starbase Lite (BisectHosting) theme palette
-- Balanced readability with brand colors
-- Colors from https://www.bisecthosting.com

local palette = {
    -- Standard colors (identical across all themes)
    background = "#1a1a1a",
    dark1 = "#171717",
    dark2 = "#101010",
    white = "#fcfcfa",

    -- Theme-specific ANSI colors (readable + BisectHosting brand)
    red = "#ff5555",       -- Standard terminal red (readable)
    orange = "#fc9867",    -- Standard warm orange (readable)
    yellow = "#ffd866",    -- Golden yellow (readable)
    green = "#84cc16",     -- Lime green brand accent
    blue = "#1b57c4",      -- Deep blue brand color
    magenta = "#b739f2",   -- PRIMARY purple brand color

    -- Dimmed colors (identical across all themes)
    dimmed1 = "#c1c0c0",
    dimmed2 = "#939293",
    dimmed3 = "#727072",
    dimmed4 = "#5b595c",
    dimmed5 = "#403e41",
}

return palette
