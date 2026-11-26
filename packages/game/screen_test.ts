// The full-screen control follows browser state rather than guessing on clicks.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { fullscreen, fullscreenButton } from './screen.ts'

test('full screen is offered only where supported', () => {
  let { document } = parseHTML('<html><body></body></html>')
  assertEquals(fullscreen(document, () => {}, () => {}), null)
})

test('full screen enters, exits, and follows browser Escape', async () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let entered = 0, left = 0, changes = 0
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
  let screen = fullscreen(document, () => {}, () => changes++)!
  assertEquals(screen.on, false)
  await screen.toggle()
  assertEquals([entered, screen.on, screen.busy], [1, true, false])
  await screen.toggle()
  assertEquals([left, screen.on], [1, false])
  // The browser leaves full screen on Escape, and the tray hears it.
  change(document.documentElement)
  let heard = changes
  change(null)
  assertEquals([screen.on, changes], [false, heard + 1])
})

test('a refused full-screen request is reported and can be retried', async () => {
  let { document } = parseHTML('<html><body></body></html>')
  Object.assign(document, {
    fullscreenEnabled: true,
    exitFullscreen: () => Promise.resolve(),
  })
  let error = new Error('refused'), reported: unknown
  document.documentElement.requestFullscreen = () => Promise.reject(error)
  let screen = fullscreen(document, (e) => reported = e, () => {})!
  await screen.toggle()
  assertEquals(reported, error)
  assertEquals([screen.on, screen.busy], [false, false])
})

test('the fullscreen button tracks the browser and detaches on disposal', () => {
  let { document, window } = parseHTML('<button hidden></button>')
  let button = document.querySelector('button')!
  Object.assign(document, {
    fullscreenEnabled: true,
    exitFullscreen: () => Promise.resolve(),
  })
  document.documentElement.requestFullscreen = () => {
    Object.assign(document, { fullscreenElement: document.documentElement })
    document.dispatchEvent(new window.Event('fullscreenchange'))
    return Promise.resolve()
  }
  let dispose = fullscreenButton(button, () => {})
  assertEquals([button.hidden, button.textContent], [false, 'Enter fullscreen'])
  button.click()
  assertEquals(button.textContent, 'Exit fullscreen')
  dispose()
  assertEquals(button.hidden, true)
})
