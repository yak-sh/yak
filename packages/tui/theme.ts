/**
 * The class sheet: what a class name means to the painter. Names follow the
 * same `Block_Element-modifier` spelling the web uses, so one tree can be
 * styled by a stylesheet in a browser and by this table in a terminal. The
 * default palette is Everforest; pass your own sheet to the backend to change
 * or extend it — an entry replaces the default of the same name.
 *
 * @module
 */

/** Everything a class can say about the text under it. */
export type Style = {
  /** Foreground colour, `#rrggbb`. */
  fg?: string
  /** Background colour, `#rrggbb`. */
  bg?: string
  /** Bold. */
  bold?: boolean
  /** Dim. */
  dim?: boolean
  /** Italic. */
  italic?: boolean
  /** Underline. */
  underline?: boolean
  /** Strikethrough. */
  strike?: boolean
  /** Swap foreground and background — how a cursor and a selection show. */
  inverse?: boolean
  /** An OSC 8 hyperlink target; set from an `<a href>`, never from the sheet. */
  href?: string
  /** Paint this instead of the element's children. */
  glyph?: string
  /** Shift this element's lines right by n columns. */
  indent?: number
  /** A blank line after this element's lines. */
  gap?: boolean
}

/** A class sheet: class name to style. */
export type Sheet = Record<string, Style>

/** Everforest, as the palette the default sheet draws from. */
export let everforest = {
  fg: '#d3c6aa',
  surface: '#343f44',
  grey: '#7a8478',
  muted: '#9da9a0',
  green: '#a7c080',
  blue: '#7fbbb3',
  yellow: '#dbbc7f',
  red: '#e67e80',
  orange: '#e69875',
  purple: '#d699b6',
}

/** The default sheet: a small generic vocabulary, in Everforest. */
export let theme: Sheet = {
  Title: { bold: true },
  Muted: { fg: everforest.muted },
  Dim: { fg: everforest.grey, dim: true },
  Key: { fg: everforest.yellow },
  Accent: { fg: everforest.blue },
  Code: { fg: everforest.blue, bg: everforest.surface },
  Quote: { fg: everforest.fg, bg: everforest.surface, dim: false },
  Good: { fg: everforest.green },
  Task: { fg: everforest.orange },
  Composer_Border: { fg: everforest.grey, dim: true },
  Warn: { fg: everforest.yellow },
  Bad: { fg: everforest.red },
  Link: { fg: everforest.blue, underline: true },
  Table_Border: { fg: everforest.grey, dim: true },
  Table_Header: { bold: true },
  Rule: { fg: everforest.grey },
  Sel: { inverse: true },
  // The text cursor is a painted cell: the terminal's own cursor is hidden, so
  // an inverted character is the only thing saying where typing lands.
  Cursor: { inverse: true },
  Scrollbar: { fg: everforest.grey },
  Scrollbar_Snapped: { dim: true },
  Frame_Side: {},
  Session_Selected: { bg: '#343f44' },
  Panel: { gap: true },
  Panel_Title: { fg: everforest.grey, bold: true },
  Entry: { fg: everforest.fg },
  Entry_Hint: { fg: everforest.grey, dim: true },
}
