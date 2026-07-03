local M = {}

function M.build(palette, helpers)
  local hp = helpers
  local p = palette

  local dimmed1 = hp.blend(p.foreground, 0.74, p.background)
  local dimmed2 = hp.blend(p.foreground, 0.54, p.background)
  local dimmed3 = hp.blend(p.foreground, 0.39, p.background)
  local dimmed4 = hp.blend(p.foreground, 0.29, p.background)
  local dimmed5 = hp.blend(p.foreground, 0.17, p.background)
  local surface = hp.darken(p.background, 3)
  local panel = hp.darken(p.background, 10)

  local c = {}

  c.editor = {
    background = p.background,
    foreground = p.foreground,
    lineHighlightBackground = hp.blend(p.foreground, 0.05, p.background),
    selectionBackground = hp.blend(dimmed1, 0.15, p.background),
    findMatchBackground = hp.blend(p.foreground, 0.15, p.background),
    findMatchBorder = p.yellow,
    findMatchHighlightBackground = hp.blend(p.foreground, 0.15, p.background),
    foldBackground = hp.blend(p.foreground, 0.1, p.background),
    wordHighlightBackground = hp.blend(p.foreground, 0.15, p.background),
    selectionHighlightBackground = hp.blend(p.foreground, 0.15, p.background),
    wordHighlightStrongBackground = hp.blend(p.foreground, 0.15, p.background),
  }

  c.editorLineNumber = {
    foreground = dimmed4,
    activeForeground = dimmed1,
  }

  c.editorHoverWidget = {
    background = dimmed5,
    border = p.background,
  }

  c.editorSuggestWidget = {
    background = dimmed5,
    border = dimmed5,
    foreground = dimmed1,
    highlightForeground = p.foreground,
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
    background = p.background,
    foreground = dimmed2,
  }

  c.sideBarTitle = {
    foreground = dimmed4,
  }

  c.list = {
    activeSelectionBackground = hp.blend(p.foreground, 0.11, p.background),
  }

  c.sideBarSectionHeader = {
    background = p.background,
    foreground = dimmed1,
  }

  c.breadcrumb = {
    foreground = dimmed2,
  }

  c.button = {
    background = dimmed5,
    foreground = dimmed1,
    hoverBackground = dimmed4,
    separator = p.background,
  }

  c.scrollbarSlider = {
    hoverBackground = hp.blend(dimmed1, 0.15, p.background),
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
    errorBackground = hp.blend(p.red, 0.1, p.background),
    errorForeground = p.red,
    warningBackground = hp.blend(p.cyan, 0.1, p.background),
    warningForeground = p.cyan,
    infoBackground = hp.blend(p.blue, 0.1, p.background),
    infoForeground = p.blue,
    hintBackground = hp.blend(p.blue, 0.1, p.background),
    hintForeground = p.blue,
  }

  c.terminal = {
    background = dimmed5,
    foreground = p.foreground,
  }

  c.terminalCursor = {
    background = p.foreground,
    foreground = p.foreground,
  }

  c.editorGroupHeader = {
    tabsBackground = p.background,
    tabsBorder = p.background,
  }

  c.tab = {
    activeBackground = p.background,
    activeBorder = p.yellow,
    activeForeground = p.yellow,
    inactiveBackground = hp.lighten(p.background, 15),
    inactiveForeground = dimmed2,
    unfocusedActiveBackground = p.background,
    unfocusedActiveBorder = dimmed2,
    unfocusedActiveForeground = dimmed1,
  }

  c.statusBar = {
    background = panel,
    foreground = dimmed3,
    activeForeground = dimmed1,
  }

  c.diffEditor = {
    insertedLineBackground = hp.blend(p.green, 0.1, p.background),
    removedLineBackground = hp.blend(p.red, 0.1, p.background),
    modifiedLineBackground = hp.blend(p.cyan, 0.1, p.background),
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
    background = p.background,
    foreground = p.foreground,
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
