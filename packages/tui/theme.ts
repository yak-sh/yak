/**
 * The class sheet: what a class name means to the painter. Names follow the
 * `Block_Element-modifier` convention a stylesheet uses, so one tree can be
 * styled by CSS in a browser and by a sheet in a terminal. Colours are a
 * theme's (@yaks/ui); what this package's own widgets are without colour
 * (a painted cursor is inverse, a header bold) is {@link base}, which every
 * sheet given to the painter extends.
 *
 * @module
 */

/** Everything a class can set on the text under it. */
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
  /** Lay this element out as a block, on lines of its own, whatever its tag:
   * CSS's `display: block` for a `button` or a `span`. */
  block?: boolean
  /** Keep the runs on this element's lines apart with a space, as a CSS gap
   * keeps a flex row's items apart in a browser. Not inherited, as a gap is
   * not. */
  spaced?: boolean
  /** Lay this element's children side by side, as a `row` attribute does. */
  row?: boolean
  /** Stack this element's children, `grow` ones sharing the rows left, as a
   * `col` attribute does. */
  col?: boolean
  /** In a row, this many columns wide, as a `width` attribute says. */
  width?: number
  /** In a row or a column, take what is left, as a `grow` attribute does. */
  grow?: boolean
  /** Frame this element in a line of the sheet's class of this name, as a
   * `border` attribute does. */
  border?: string
}

/** A class sheet: class name to style. */
export type Sheet = Record<string, Style>

/** This package's widgets, without colour: the text entry's painted cursor
 * and hint, a table's rules and header, a panel and its title, a selected
 * list row, a scrollbar resting at the bottom. */
export let base: Sheet = {
  // The text cursor is a painted cell: the terminal's own cursor is hidden, so
  // an inverted character is the only thing saying where typing lands.
  Cursor: { inverse: true },
  Entry_Hint: { dim: true },
  Table_Border: { dim: true },
  Table_Header: { bold: true },
  Panel: { gap: true },
  Panel_Title: { bold: true },
  List_Selected: { inverse: true },
  Scrollbar_Snapped: { dim: true },
}
