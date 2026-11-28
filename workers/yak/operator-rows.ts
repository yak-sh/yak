// What the chat page's script draws with, in the browser as `_talk.js`
// (assets.ts): its conversation, mounted over what the server drew
// (operator-talk-browser.ts), and the aside beside it, drawn as elements of the
// page's document for the parts of the page the script puts in place.
import { createElement as h, type ReactNode } from 'react'
import { fragment } from '@yaks/html/dom'
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
export { rememberChat } from '@yaks/platform/operator-copy-browser'

// Its message box (operator-box-browser.ts), whose words are drafts bound here, in
// the same bundle, so a draft changed anywhere draws the box again.
export { mountAsk } from './operator-box-browser.ts'
export { browserDrafts } from '@yaks/draft/browser'
export { takeEarlyDraft } from '@yaks/platform/operator-early-draft'

// The aside beside the lines, drawn the same way (operator-aside.ts).
export { long, ordered, showing } from './operator-aside.ts'

// What `node` draws, as one element of `doc`.
let one = (doc: Document, node: ReactNode) =>
  fragment(doc, node).firstElementChild as HTMLElement

/** The aside. */
export let asideDrawn = (doc: Document, aside: Aside, now = Date.now()) =>
  one(doc, h(Aside, { aside, now }))

/** The summary the bar's button to the aside wears. */
export let glanceDrawn = (doc: Document, aside: Aside) =>
  one(doc, h(Glance, { aside }))

/** The turn's line. */
export let turnDrawn = (doc: Document, turn: Turn | null, now = Date.now()) =>
  one(doc, h(TurnNow, { turn, now }))

/** A helper's row, as every place on the page draws it: with `fold` as the
 * Helpers box does, its fold `open` or not. */
export let helperDrawn = (
  doc: Document,
  helper: HelperLine,
  now = Date.now(),
  fold = false,
  open = false,
) => one(doc, h(Work, { work: helper, now, fold, open }))

/** A helper's own row on its own page (operator-aside.ts `Self`). */
export let selfDrawn = (doc: Document, helper: HelperLine, now = Date.now()) =>
  one(doc, h(Self, { self: helper, now }))

/** How a piece of work stands, as the pip beside its title. */
export let markDrawn = (doc: Document, standing: HelperLine['standing']) =>
  one(doc, h(Mark, { standing }))

// Its times said in the reader's clock and zone (dates.ts).
export { dates } from './dates.ts'

export { menus, tips } from '@yaks/ui/parts'
export { leaving } from '@yaks/ui/navigate'
export { sleep } from '@yaks/fp'

// The page's store, asked through @yaks/api (operator-api.ts), and the
// person's drafts and conversation in it, kept in the page graph, and
// whether a read of it holds a step heard meanwhile.
export { operatorAt } from './operator-api-page.ts'
export { pageDrafts } from '@yaks/platform/operator-drafts-browser'
export { pageTalk } from '@yaks/platform/operator-talk-browser'
export { covers } from '@yaks/platform/operator-talk'
