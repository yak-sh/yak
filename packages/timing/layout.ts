/** How this package lays out lines of figures, in place, as the page's sheet
 * holds no rules of its own: a name that wraps rather than being cut, then
 * its figures in columns of a fixed width at the line's end, so the figures
 * of every line stand in columns; on a narrow screen they drop below it.
 * @module
 */

export let list = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  fontSize: '13px',
}
export let line = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  columnGap: '1em',
  padding: '3px var(--half-gap)',
  borderBottom: '1px solid var(--border)',
}
export let name = (depth: number) => ({
  flex: '1 1 14em',
  minWidth: 0,
  paddingLeft: `${depth * 1.1}em`,
  overflowWrap: 'anywhere',
})
export let figures = {
  display: 'flex',
  alignItems: 'center',
  columnGap: '1em',
  marginLeft: 'auto',
}
// A fixed width, so the figures of every line stand in columns; a heading
// wider than its column wraps.
export let number = {
  width: '6em',
  flex: 'none',
  textAlign: 'right',
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--number)',
}
export let heading = {
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  color: 'var(--dim)',
}
export let quiet = { color: 'var(--dim)' }
