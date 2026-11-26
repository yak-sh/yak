import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { imageFallbacks } from './image-fallback.ts'

// An app's mark over an image whose loading the test sets.
let marked = () => {
  let { document, Event } = parseHTML('<img data-app-mark-image src="one.png">')
  let image = document.querySelector('img')!
  let current = { src: '', complete: false, width: 0 }
  Object.defineProperties(image, {
    currentSrc: { get: () => current.src },
    complete: { get: () => current.complete },
    naturalWidth: { get: () => current.width },
  })
  let ready = () => image.hasAttribute('data-app-mark-ready')
  let sent = (type: string) =>
    image.dispatchEvent(new Event(type, { bubbles: true }))
  imageFallbacks(document)
  return { document, Event, image, current, ready, sent }
}

// An app's mark over an image whose loading the test sets.
test('a mark covers a pending or failed image and clears for a loaded source', () => {
  let { document, Event, image, current, ready, sent } = marked()
  assertEquals(ready(), false)
  Object.assign(current, { src: image.src, complete: true, width: 512 })
  sent('load')
  assertEquals(ready(), true)

  image.src = 'two.png'
  document.dispatchEvent(new Event('yak-page'))
  assertEquals(ready(), false)
  Object.assign(current, { src: image.src, width: 0 })
  sent('error')
  assertEquals(ready(), false)
})

test('a redraw that takes the mark from a loaded image leaves it shown', async () => {
  let { image, current, ready, sent } = marked()
  Object.assign(current, { src: image.src, complete: true, width: 512 })
  sent('load')
  image.removeAttribute('data-app-mark-ready')
  await Promise.resolve()
  assertEquals(ready(), true)
})
