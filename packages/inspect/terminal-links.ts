// Terminal links and pickable rows, used by renderer tests without an app shell.
import { TElement } from '@yaks/tui'
let elements = (el: TElement) =>
  el.childNodes.filter((n): n is TElement => 'localName' in n)
export let stops = (el: TElement | undefined): TElement[] =>
  !el ? [] : [
    ...el.attr('data-pick') || el.localName == 'a' && el.attr('href')
      ? [el]
      : [],
    ...elements(el).flatMap(stops),
  ]
export let linkOf = (el: TElement | null | undefined): string | undefined => {
  for (let n = el; n; n = n.parentNode as TElement | null) {
    if (n.localName == 'a' && n.attr('href')) return n.attr('href')
  }
}
