// What the chat page's script draws with, in the browser as `_talk.js`
// (client-assets.ts): its conversation, mounted over what the server drew
// (operator-talk.ts), and the aside beside it, drawn as HTML for the parts of
// the page the script puts in place.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import {
  Aside,
  Glance,
  type HelperLine,
  type Turn,
  TurnNow,
  Work,
} from './operator-aside.ts'

export { mountTalk } from './operator-talk.ts'

// Its message box (operator-box.ts), whose words are drafts bound here, in
// the same bundle, so a draft changed anywhere draws the box again.
export { mountAsk } from './operator-box.ts'
export { browserDrafts } from '@yaks/draft/browser'

// The aside beside the lines, drawn the same way (operator-aside.ts).
export { ordered, showing } from './operator-aside.ts'

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

// The page's store, read and written through @yaks/api (operator-api.ts).
export { storeAt } from './operator-api-page.ts'
