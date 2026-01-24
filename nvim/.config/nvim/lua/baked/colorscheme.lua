local M = {}

function M.build(palette, helpers)
  local hp = helpers
  local p = palette

  local c = {}

  c.editor = {
    background = p.background,
    foreground = p.white,
    lineHighlightBackground = hp.blend(p.white, 0.05, p.background),
    selectionBackground = hp.blend(p.dimmed1, 0.15, p.background),
    findMatchBackground = hp.blend(p.white, 0.15, p.background),
    findMatchBorder = p.yellow,
    findMatchHighlightBackground = hp.blend(p.white, 0.15, p.background),
    foldBackground = hp.blend(p.white, 0.1, p.background),
    wordHighlightBackground = hp.blend(p.white, 0.15, p.background),
    selectionHighlightBackground = hp.blend(p.white, 0.15, p.background),
    wordHighlightStrongBackground = hp.blend(p.white, 0.15, p.background),
  }

  c.editorLineNumber = {
    foreground = p.dimmed4,
    activeForeground = p.dimmed1,
  }

  c.editorHoverWidget = {
    background = p.dimmed5,
    border = p.background,
  }

  c.editorSuggestWidget = {
    background = p.dimmed5,
    border = p.dimmed5,
    foreground = p.dimmed1,
    highlightForeground = p.white,
    selectedBackground = p.dimmed3,
  }

  c.editorIndentGuide = {
    background = p.dimmed5,
    activeBackground = p.dimmed3,
  }

  c.editorInlayHint = {
    background = p.dimmed5,
    foreground = p.dimmed2,
  }

  c.editorGutter = {
    addedBackground = p.green,
    deletedBackground = p.red,
    modifiedBackground = p.orange,
  }

  c.sideBar = {
    background = p.dark1,
    foreground = p.dimmed2,
  }

  c.sideBarTitle = {
    foreground = p.dimmed4,
  }

  c.list = {
    activeSelectionBackground = hp.blend(p.white, 0.11, p.dark1),
  }

  c.sideBarSectionHeader = {
    background = p.dark1,
    foreground = p.dimmed1,
  }

  c.breadcrumb = {
    foreground = p.dimmed2,
  }

  c.button = {
    background = p.dimmed5,
    foreground = p.dimmed1,
    hoverBackground = p.dimmed4,
    separator = p.background,
  }

  c.scrollbarSlider = {
    hoverBackground = hp.blend(p.dimmed1, 0.15, p.background),
  }

  c.gitDecoration = {
    addedResourceForeground = p.green,
    conflictingResourceForeground = p.orange,
    deletedResourceForeground = p.red,
    ignoredResourceForeground = p.dimmed4,
    modifiedResourceForeground = p.yellow,
    stageDeletedResourceForeground = p.red,
    stageModifiedResourceForeground = p.yellow,
    untrackedResourceForeground = p.dimmed2,
  }

  c.inputValidation = {
    errorBackground = p.dimmed5,
    errorBorder = p.red,
    errorForeground = p.red,
    infoBackground = p.dimmed5,
    infoBorder = p.cyan,
    infoForeground = p.cyan,
    warningBackground = p.dimmed5,
    warningBorder = p.orange,
    warningForeground = p.orange,
  }

  c.errorLens = {
    errorBackground = hp.blend(p.red, 0.1, p.background),
    errorForeground = p.red,
    warningBackground = hp.blend(p.orange, 0.1, p.background),
    warningForeground = p.orange,
    infoBackground = hp.blend(p.cyan, 0.1, p.background),
    infoForeground = p.cyan,
    hintBackground = hp.blend(p.cyan, 0.1, p.background),
    hintForeground = p.cyan,
  }

  c.terminal = {
    background = p.dimmed5,
    foreground = p.white,
  }

  c.terminalCursor = {
    background = "#ffffff",
    foreground = p.white,
  }

  c.editorGroupHeader = {
    tabsBackground = p.dark1,
    tabsBorder = p.dark1,
  }

  c.tab = {
    activeBackground = p.background,
    activeBorder = p.yellow,
    activeForeground = p.yellow,
    inactiveBackground = hp.lighten(p.background, 15),
    inactiveForeground = p.dimmed2,
    unfocusedActiveBackground = p.background,
    unfocusedActiveBorder = p.dimmed2,
    unfocusedActiveForeground = p.dimmed1,
  }

  c.statusBar = {
    background = p.dark2,
    foreground = p.dimmed3,
    activeForeground = p.dimmed1,
  }

  c.diffEditor = {
    insertedLineBackground = hp.blend(p.green, 0.1, p.dark1),
    removedLineBackground = hp.blend(p.red, 0.1, p.dark1),
    modifiedLineBackground = hp.blend(p.orange, 0.1, p.dark1),
  }

  c.diffEditorOverview = {
    insertedForeground = hp.blend(p.green, 0.65, c.diffEditor.insertedLineBackground),
    removedForeground = hp.blend(p.red, 0.65, c.diffEditor.removedLineBackground),
    modifiedForeground = hp.blend(p.orange, 0.65, c.diffEditor.modifiedLineBackground),
  }

  c.notifications = {
    background = p.dimmed5,
    border = p.dimmed5,
    foreground = p.dimmed1,
  }

  c.notificationsErrorIcon = {
    foreground = p.red,
  }

  c.notificationsInfoIcon = {
    foreground = p.cyan,
  }

  c.notificationsWarningIcon = {
    foreground = p.orange,
  }

  c.base = {
    dark = p.dark2,
    black = p.dark1,
    red = p.red,
    green = p.green,
    yellow = p.yellow,
    blue = p.orange,
    magenta = p.magenta,
    cyan = p.cyan,
    white = p.white,
    dimmed1 = p.dimmed1,
    dimmed2 = p.dimmed2,
    dimmed3 = p.dimmed3,
    dimmed4 = p.dimmed4,
    dimmed5 = p.dimmed5,
  }

  return c
end

return M
