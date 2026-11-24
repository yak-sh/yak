// What the chat page's script draws with, in the browser as `_talk.js`
// (assets.ts): its conversation, mounted over what the server drew
// (operator-talk-browser.ts), and the aside beside it, drawn as HTML for the parts of
// the page the script puts in place.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import '@yaks/platform/updates-browser'
import {
  Aside,
  Glance,
  type HelperLine,
  Mark,
  Self,
  type Turn,
  TurnNow,
  Work,
} from './operator-aside.ts'

export { mountTalk } from './operator-talk-browser.ts'

// Its message box (operator-box-browser.ts), whose words are drafts bound here, in
// the same bundle, so a draft changed anywhere draws the box again.
export { mountAsk } from './operator-box-browser.ts'
export { browserDrafts } from '@yaks/draft/browser'

// The aside beside the lines, drawn the same way (operator-aside.ts).
export { long, ordered, showing } from './operator-aside.ts'

/** The aside as HTML. */
export let asideHtml = (aside: Aside, now = Date.now()) =>
  renderToString(h(Aside, { aside, now }))

/** The summary the bar's button to the aside wears, as HTML. */
export let glanceHtml = (aside: Aside, reach = false) =>
  renderToString(h(Glance, { aside, reach }))

/** The turn's line as HTML. */
export let turnHtml = (turn: Turn | null, now = Date.now()) =>
  renderToString(h(TurnNow, { turn, now }))

/** A helper's row as HTML, as every place on the page draws it: with
 * `fold` as the Helpers box does, its fold `open` or not. */
export let helperHtml = (
  helper: HelperLine,
  now = Date.now(),
  fold = false,
  open = false,
) => renderToString(h(Work, { work: helper, now, fold, open }))
/** A helper's own row on its own page as HTML (operator-aside.ts `Self`). */
export let selfHtml = (helper: HelperLine, now = Date.now()) =>
  renderToString(h(Self, { self: helper, now }))

/** How a piece of work stands, as the pip beside its title, as HTML. */
export let markHtml = (standing: HelperLine['standing']) =>
  renderToString(h(Mark, { standing }))

// Its times said in the reader's clock and zone (dates.ts).
export { dates } from './dates.ts'

export { menus, tips } from '@yaks/ui/parts'
export { leaving } from '@yaks/ui/navigate'
export { sleep } from '@yaks/fp'

// The page's store, read and written through @yaks/api (operator-api.ts).
export { storeAt } from './operator-api-page.ts'
