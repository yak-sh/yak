// The chat page's lines drawn as HTML from what its socket sends
// (operator-draw.ts `Lines`): in the browser, as `_talk.js` (client-assets.ts),
// which the page puts in place by id (public/redraw.js); and in the Builder
// object for a page that opened its socket before lines were sent as data.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Host } from '@yaks/markdown'
import { drawLines, type Line, type Lines, opening } from './operator-draw.ts'
import {
  Aside,
  Glance,
  type HelperLine,
  type Turn,
  TurnNow,
  Work,
} from './operator-aside.ts'

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
export { ordered } from './operator-aside.ts'

/** The aside as HTML, its list shown or not. */
export let asideHtml = (aside: Aside, open = false, now = Date.now()) =>
  renderToString(h(Aside, { aside, now, open }))

/** The summary's button as HTML. */
export let glanceHtml = (aside: Aside, open = false) =>
  renderToString(h(Glance, { aside, open }))

/** The turn's line as HTML. */
export let turnHtml = (turn: Turn | null, now = Date.now()) =>
  renderToString(h(TurnNow, { turn, now }))

/** A helper's row as HTML, as every place on the page draws it. */
export let helperHtml = (helper: HelperLine, now = Date.now()) =>
  renderToString(h(Work, { work: helper, now }))
// Its times said in the reader's clock and zone (dates.ts).
export { dates } from './dates.ts'

export { menus, tips } from '@yaks/ui/parts'
