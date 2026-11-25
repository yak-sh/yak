/**
 * The views of an Operator page (D-475 step 4): the conversation, the
 * space's Updates, and every space's Updates where the page opened there.
 * The server draws them all in one document, the one the address names shown
 * and the others hidden, and a press on the side's link to another of them
 * shows it in place (./talk-views-browser.ts): no page is fetched and no node
 * is drawn again, so the press lands in one frame. A hidden view stays
 * standing: Updates draws its cards from the tab's page graph
 * (./updates-list-browser.ts) and the conversation is heard there, so a view
 * shown is current.
 *
 * Each view's element says how it is shown (`TalkView`, `VIEW`).
 *
 * @module
 */

/** How a view is shown: the address it stands for, the side's link lit while
 * it shows, the bar's title, the document's title, where the skip link goes
 * and what it says, whether the frame's aside stands beside it, and whether
 * it is every space's Updates (`all`), which the side lights apart. */
export type TalkView = {
  here: string
  link: string
  title: string
  page: string
  skip: [string, string]
  aside: boolean
  all: boolean
}

/** The attribute on each view's element, holding its `TalkView`. */
export let VIEW = 'data-talk-view'

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
