// The chat page's lines drawn as HTML from what its socket sends
// (operator-draw.ts `Lines`): in the browser, as `_talk.js` (client-assets.ts),
// which the page puts in place by id (public/redraw.js); and in the Builder
// object for a page that opened its socket before lines were sent as data.
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { drawLines, type Line, type Lines } from './operator-draw.ts'

/** A drawn line of a transcript: what it shows, under the id it is put by. */
export type Row = { id: string; html: string }

/** A line drawn as HTML. */
export let drawn = ({ id, node }: Pick<Line, 'id' | 'node'>): Row => ({
  id,
  html: renderToString(h(Fragment, null, node)),
})

/** Each line sent, drawn as HTML. */
export let rowsOf = (sent: Lines): Row[] => drawLines(sent).map(drawn)

// The aside beside the lines, drawn the same way (operator-aside.ts).
export {
  asideHtml,
  glanceHtml,
  helperHtml,
  lasted,
  ordered,
  turnHtml,
} from './operator-aside.ts'

export { menus, tips } from '@yaks/ui/parts'
