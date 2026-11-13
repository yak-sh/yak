// The chat page's lines drawn as HTML from what its socket sends
// (operator-draw.ts `Lines`): in the browser, as `_talk.js` (client-assets.ts),
// which the page puts in place by id (public/redraw.js); and in the Builder
// object for a page that opened its socket before lines were sent as data.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Host } from '@yaks/markdown'
import { drawLines, type Line, type Lines, opening } from './operator-draw.ts'

/** A drawn line of a transcript: what it shows, under the id it is put by. */
export type Row = { id: string; html: string }

/** A line drawn as HTML, its ids opening at `mentions` (operator-draw.ts
 * `opening`), the reader's own server. */
export let drawn = (
  { id, node }: Pick<Line, 'id' | 'node'>,
  mentions?: string,
): Row => ({
  id,
  html: renderToString(h(Host.Provider, { value: opening(mentions) }, node)),
})

/** Each line sent, drawn as HTML, its ids opening at `mentions`. */
export let rowsOf = (sent: Lines, mentions?: string): Row[] =>
  drawLines(sent).map((line) => drawn(line, mentions))

// The aside beside the lines, drawn the same way (operator-aside.ts).
export {
  asideHtml,
  glanceHtml,
  helperHtml,
  lasted,
  ordered,
  turnHtml,
} from './operator-aside.ts'
export { relative } from '@yaks/ui/relative'

export { menus, tips } from '@yaks/ui/parts'
