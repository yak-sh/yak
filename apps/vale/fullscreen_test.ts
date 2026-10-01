// The full-screen control follows browser state rather than guessing on clicks.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { fullscreen } from './ui/fullscreen.ts'

test('full screen is offered only where supported', () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  assertEquals(fullscreen(document, () => {}), null)
})

test('full screen enters, exits, and follows browser Escape', async () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let entered = 0, left = 0
  let change = (element: Element | null) => {
    Object.assign(document, { fullscreenElement: element })
    document.dispatchEvent(new window.Event('fullscreenchange'))
  }
  Object.assign(document, {
    fullscreenEnabled: true,
    exitFullscreen: () => {
      left++
      change(null)
      return Promise.resolve()
    },
  })
  document.documentElement.requestFullscreen = () => {
    entered++
    change(document.documentElement)
    return Promise.resolve()
  }
  let button = fullscreen(document, () => {})!
  assertEquals(button.getAttribute('aria-label'), 'Full screen')
  button.click()
  await Promise.resolve()
  assertEquals(entered, 1)
  assertEquals(button.getAttribute('aria-pressed'), 'true')
  assertEquals(button.getAttribute('aria-label'), 'Leave full screen')
  button.click()
  await Promise.resolve()
  assertEquals(left, 1)
  assertEquals(button.getAttribute('aria-pressed'), 'false')
  button.click()
  await Promise.resolve()
  change(null)
  assertEquals(button.getAttribute('aria-pressed'), 'false')
  assertEquals(button.disabled, false)
})

test('a refused full-screen request is reported and can be retried', async () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  Object.assign(document, { fullscreenEnabled: true })
  let error = new Error('refused'), reported: unknown
  document.documentElement.requestFullscreen = () => Promise.reject(error)
  let button = fullscreen(document, (e) => reported = e)!
  button.click()
  await Promise.resolve()
  await Promise.resolve()
  assertEquals(reported, error)
  assertEquals(button.disabled, false)
  assertEquals(button.getAttribute('aria-pressed'), 'false')
})
