import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { PAGE } from '@yaks/ui/navigate'
import { opening } from './operator-opening-browser.ts'

test('a slot a swap kept in place after its page left is opened again, and one still open is not', () => {
  let { document, Event } = parseHTML(
    '<main><div data-operator-opening="/a/operator?conversation=1"></div></main>',
  )
  let opened: AbortController[] = []
  opening(document, () => {
    let leave = new AbortController()
    opened.push(leave)
    return leave.signal
  })
  document.dispatchEvent(new Event(PAGE))
  equal(opened.length, 1)
  opened[0].abort()
  document.dispatchEvent(new Event(PAGE))
  equal(opened.length, 2)
})
