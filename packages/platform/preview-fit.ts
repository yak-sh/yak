// Whether a rendered page fits its window's width. A page wider than its
// window scrolls sideways on a phone, which a screenshot shows only as text
// cut off at the edge, so a preview says it in words beside the accessibility
// report. A diagnostic, never a deploy restriction.

/** A page's width against its window's, and the outermost elements reaching
 * past the window's right edge, each named as CSS would select it with how far
 * right it reaches. */
export type Fit = { page: number; window: number; past: string[] }

/**
 * The script a render runs in the page to measure its {@link Fit}: a function
 * of the document and the window. An element whose own box scrolls or clips
 * (`overflow-x` other than visible) holds what reaches past it, so the walk
 * does not go inside one; an element past the edge is listed and its children
 * are not. Written as the script it runs, since a bundler's helpers would not
 * come along with a function's own text.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { FIT } from '@yaks/platform/preview-fit'
 * let el = (cls: string, right: number, children: object[] = []) => ({
 *   tagName: 'DIV', id: '', classList: [cls], children,
 *   getBoundingClientRect: () => ({ right, width: right }),
 * })
 * let body = el('page', 390, [el('today', 470, [el('inner', 470)]), el('ok', 380)])
 * let doc = { documentElement: { scrollWidth: 470 }, body }
 * let view = { innerWidth: 390, getComputedStyle: () => ({ overflowX: 'visible' }) }
 * equal((0, eval)(FIT)(doc, view), { page: 470, window: 390, past: ['div.today (470 px)'] })
 * equal((0, eval)(FIT)({ ...doc, documentElement: { scrollWidth: 390 } }, view).past, [])
 * ```
 */
export let FIT = `((doc, view) => {
  let width = view.innerWidth
  let page = doc.documentElement.scrollWidth
  let past = []
  let name = (el) => el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : el.classList.length ? '.' + el.classList[0] : '')
  let walk = (el) => {
    if (past.length >= 5) return
    let box = el.getBoundingClientRect()
    if (box.width > 0 && box.right > width + 1) {
      past.push(name(el) + ' (' + Math.round(box.right) + ' px)')
      return
    }
    if (view.getComputedStyle(el).overflowX != 'visible') return
    for (let i = 0; i < el.children.length; i++) walk(el.children[i])
  }
  if (page > width && doc.body) {
    for (let i = 0; i < doc.body.children.length; i++) walk(doc.body.children[i])
  }
  return { page, window: width, past }
})`

/**
 * The line a preview says of how its page fits.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { fitted } from '@yaks/platform/preview-fit'
 * equal(fitted({ page: 390, window: 390, past: [] }), 'Layout: the page fits the 390 px window.')
 * equal(
 *   fitted({ page: 470, window: 390, past: ['div.today (470 px)'] }),
 *   'Layout: the page is 470 px wide in a 390 px window, so it scrolls sideways. Past the right edge: div.today (470 px).',
 * )
 * ```
 */
export let fitted = ({ page, window, past }: Fit): string =>
  page <= window
    ? `Layout: the page fits the ${window} px window.`
    : `Layout: the page is ${page} px wide in a ${window} px window, so it scrolls sideways.` +
      (past.length ? ` Past the right edge: ${past.join(', ')}.` : '')
