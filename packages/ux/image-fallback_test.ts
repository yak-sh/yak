import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { imageFallbacks } from './image-fallback.ts'

test('a mark covers a pending or failed image and clears for a loaded source', () => {
  let { document, Event } = parseHTML('<img data-app-mark-image src="one.png">')
  let image = document.querySelector('img')!
  let currentSrc = '', complete = false, naturalWidth = 0
  Object.defineProperties(image, {
    currentSrc: { get: () => currentSrc },
    complete: { get: () => complete },
    naturalWidth: { get: () => naturalWidth },
  })
  let ready = () => image.hasAttribute('data-app-mark-ready')
  let sent = (type: string) =>
    image.dispatchEvent(new Event(type, { bubbles: true }))

  imageFallbacks(document)
  assertEquals(ready(), false)
  currentSrc = image.src
  complete = true
  naturalWidth = 512
  sent('load')
  assertEquals(ready(), true)

  image.src = 'two.png'
  document.dispatchEvent(new Event('yak-page'))
  assertEquals(ready(), false)
  currentSrc = image.src
  naturalWidth = 0
  sent('error')
  assertEquals(ready(), false)
})
