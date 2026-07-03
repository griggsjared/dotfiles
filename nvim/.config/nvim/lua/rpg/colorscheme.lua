local M = {}

function M.build(palette, helpers)
  local hp = helpers
  local p = palette

  local dimmed1 = hp.blend(p.white, 0.74, p.black)
  local dimmed2 = hp.blend(p.white, 0.54, p.black)
  local dimmed3 = hp.blend(p.white, 0.39, p.black)
  local dimmed4 = hp.blend(p.white, 0.29, p.black)
  local dimmed5 = hp.blend(p.white, 0.17, p.black)
  local surface = hp.darken(p.black, 3)
  local panel = hp.darken(p.black, 10)

  local c = {}

  c.editor = {
    background = p.black,
    foreground = p.white,
    lineHighlightBackground = hp.blend(p.white, 0.05, p.black),
    selectionBackground = hp.blend(dimmed1, 0.15, p.black),
    findMatchBackground = hp.blend(p.white, 0.15, p.black),
    findMatchBorder = p.yellow,
    findMatchHighlightBackground = hp.blend(p.white, 0.15, p.black),
    foldBackground = hp.blend(p.white, 0.1, p.black),
    wordHighlightBackground = hp.blend(p.white, 0.15, p.black),
    selectionHighlightBackground = hp.blend(p.white, 0.15, p.black),
    wordHighlightStrongBackground = hp.blend(p.white, 0.15, p.black),
  }

  c.editorLineNumber = {
    foreground = dimmed4,
    activeForeground = dimmed1,
  }

  c.editorHoverWidget = {
    background = dimmed5,
    border = p.black,
  }

  c.editorSuggestWidget = {
    background = dimmed5,
    border = dimmed5,
    foreground = dimmed1,
    highlightForeground = p.white,
    selectedBackground = dimmed3,
  }

  c.editorIndentGuide = {
    background = dimmed5,
    activeBackground = dimmed3,
  }

  c.editorInlayHint = {
    background = dimmed5,
    foreground = dimmed2,
  }

  c.editorGutter = {
    addedBackground = p.green,
    deletedBackground = p.red,
    modifiedBackground = p.cyan,
  }

  c.sideBar = {
    background = p.black,
    foreground = dimmed2,
  }

  c.sideBarTitle = {
    foreground = dimmed4,
  }

  c.list = {
    activeSelectionBackground = hp.blend(p.white, 0.11, p.black),
  }

  c.sideBarSectionHeader = {
    background = p.black,
    foreground = dimmed1,
  }

  c.breadcrumb = {
    foreground = dimmed2,
  }

  c.button = {
    background = dimmed5,
    foreground = dimmed1,
    hoverBackground = dimmed4,
    separator = p.black,
  }

  c.scrollbarSlider = {
    hoverBackground = hp.blend(dimmed1, 0.15, p.black),
  }

  c.gitDecoration = {
    addedResourceForeground = p.green,
    conflictingResourceForeground = p.cyan,
    deletedResourceForeground = p.red,
    ignoredResourceForeground = dimmed4,
    modifiedResourceForeground = p.yellow,
    stageDeletedResourceForeground = p.red,
    stageModifiedResourceForeground = p.yellow,
    untrackedResourceForeground = dimmed2,
  }

  c.inputValidation = {
    errorBackground = dimmed5,
    errorBorder = p.red,
    errorForeground = p.red,
    infoBackground = dimmed5,
    infoBorder = p.blue,
    infoForeground = p.blue,
    warningBackground = dimmed5,
    warningBorder = p.cyan,
    warningForeground = p.cyan,
  }

  c.errorLens = {
    errorBackground = hp.blend(p.red, 0.1, p.black),
    errorForeground = p.red,
    warningBackground = hp.blend(p.cyan, 0.1, p.black),
    warningForeground = p.cyan,
    infoBackground = hp.blend(p.blue, 0.1, p.black),
    infoForeground = p.blue,
    hintBackground = hp.blend(p.blue, 0.1, p.black),
    hintForeground = p.blue,
  }

  c.terminal = {
    background = dimmed5,
    foreground = p.white,
  }

  c.terminalCursor = {
    background = p.white,
    foreground = p.white,
  }

  c.editorGroupHeader = {
    tabsBackground = p.black,
    tabsBorder = p.black,
  }

  c.tab = {
    activeBackground = p.black,
    activeBorder = p.yellow,
    activeForeground = p.yellow,
    inactiveBackground = hp.lighten(p.black, 15),
    inactiveForeground = dimmed2,
    unfocusedActiveBackground = p.black,
    unfocusedActiveBorder = dimmed2,
    unfocusedActiveForeground = dimmed1,
  }

  c.statusBar = {
    background = panel,
    foreground = dimmed3,
    activeForeground = dimmed1,
  }

  c.diffEditor = {
    insertedLineBackground = hp.blend(p.green, 0.1, p.black),
    removedLineBackground = hp.blend(p.red, 0.1, p.black),
    modifiedLineBackground = hp.blend(p.cyan, 0.1, p.black),
  }

  c.diffEditorOverview = {
    insertedForeground = hp.blend(p.green, 0.65, c.diffEditor.insertedLineBackground),
    removedForeground = hp.blend(p.red, 0.65, c.diffEditor.removedLineBackground),
    modifiedForeground = hp.blend(p.cyan, 0.65, c.diffEditor.modifiedLineBackground),
  }

  c.notifications = {
    background = dimmed5,
    border = dimmed5,
    foreground = dimmed1,
  }

  c.notificationsErrorIcon = {
    foreground = p.red,
  }

  c.notificationsInfoIcon = {
    foreground = p.blue,
  }

  c.notificationsWarningIcon = {
    foreground = p.cyan,
  }

  c.base = {
    background = p.black,
    foreground = p.white,
    surface = surface,
    panel = panel,
    red = p.red,
    green = p.green,
    yellow = p.yellow,
    blue = p.blue,
    magenta = p.magenta,
    cyan = p.cyan,
    dimmed1 = dimmed1,
    dimmed2 = dimmed2,
    dimmed3 = dimmed3,
    dimmed4 = dimmed4,
    dimmed5 = dimmed5,
  }

  return c
end

return M
