/**
 * The views of an Operator page (D-475 step 4): the page the address names
 * (the conversation, a helper's, Matches, the dismissed Updates), the
 * space's Updates, and every space's Updates, each page holding them all.
 * The server draws them all in one document, the one the address names shown
 * and the others hidden, and a press on the side's link to another of them
 * shows it in place (./talk-views-browser.ts): no page is fetched and no node
 * is drawn again, so the press lands in one frame. A hidden view stays
 * standing: Updates draws its cards from the tab's page graph
 * (./updates-list-browser.ts), so it is current when shown. The conversation
 * is heard there only while it shows, since a tab watching it is on its
 * Operator (./operator-talk-browser.ts); shown again, it reads what came
 * meanwhile.
 *
 * Each view's element says how it is shown (`TalkView`, `VIEW`).
 *
 * @module
 */

/** How a view is shown: the address it stands for, the side's link lit while
 * it shows, the bar's title and what it says under it (`sub`), the
 * document's title, where the skip link goes
 * and what it says, whether the frame's aside stands beside it, whether it
 * is every space's Updates (`all`), which the side lights apart, and the
 * frame's own classes while it shows (`marks`). */
export type TalkView = {
  here: string
  link: string
  title: string
  sub?: string
  page: string
  skip: [string, string]
  aside: boolean
  all: boolean
  marks: string[]
  /** Read a fresh page when reopened, as its rows are a snapshot. */
  snapshot?: boolean
}

/** The attribute on each view's element, holding its `TalkView`. */
export let VIEW = 'data-talk-view'

/** The attribute on a part of the frame that stands only while one view
 * shows (a helper's way back out), holding that view's address. */
export let PART = 'data-talk-part'

/** The event a view's element hears as it is shown or hidden. */
export let VIEWED = 'yak-viewed'

/** The attributes of a view's element: what it is, and hidden unless it is
 * the one `shown`. */
export let viewAttrs = (view: TalkView, shown: boolean) => ({
  [VIEW]: JSON.stringify(view),
  hidden: !shown || undefined,
})

/** The view of `views` standing for the address `to` (path and query), if
 * any. */
/// viewAt([{ here: '/a/updates' }, { here: '/a' }], '/a')?.here -> '/a'
/// viewAt([{ here: '/a' }], '/a?app=b') -> undefined
export let viewAt = <V extends Pick<TalkView, 'here'>>(
  views: V[],
  to: string,
): V | undefined => views.find((v) => v.here == to)
