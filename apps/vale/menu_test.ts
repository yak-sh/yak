// The menu lets a player compare ground detail at a deliberate reload, with
// the selected size and its cost visible before applying it.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { menu, type Settings } from './menu.ts'
import type { Panel } from './panel.ts'

test('voxel slider shows a choice before applying it', () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let element = globalThis.Element, inputElement = globalThis.HTMLInputElement
  Object.assign(globalThis, {
    Element: window.Element,
    HTMLInputElement: window.HTMLInputElement,
  })
  try {
    let chosen: number | null = null
    let level = { level: 0.5, set: (_: number) => {} }
    let frames: Settings['frames'] = {
      current: 60,
      set: (rate) => frames.current = rate,
    }
    let o: Settings = {
      muted: () => false,
      mute: () => {},
      music: { ...level, muted: false, toggle: () => {} },
      effects: level,
      voice: level,
      swapped: () => false,
      swap: () => {},
      hidesCursor: () => true,
      hideCursor: () => {},
      strafes: () => false,
      strafe: () => {},
      voxel: { current: 0.25, apply: (size) => chosen = size },
      frames,
    }
    let panel: Panel = {
      body: document.body,
      open: true,
      show: () => {},
      close: () => {},
      toggle: () => {},
      head: () => {},
    }
    let settings = menu(panel, o)
    settings.show()
    let slider = document.querySelector<HTMLInputElement>('[data-voxel]')!
    let button = document.querySelector<HTMLButtonElement>('[data-do=voxel]')!
    let choice = document.querySelector('[data-voxel-choice]')!
    let cost = document.querySelector<HTMLElement>('[data-voxel-cost]')!
    assertEquals(choice.textContent, '0.25 m')
    assertEquals(button.disabled, true)
    slider.value = '0'
    slider.dispatchEvent(new window.Event('input', { bubbles: true }))
    assertEquals(choice.textContent, '0.125 m')
    assertEquals(button.disabled, false)
    assertEquals(cost.hidden, false)
    assertStringIncludes(cost.textContent ?? '', 'four times')
    assertEquals(chosen, null)
    button.dispatchEvent(new window.Event('click', { bubbles: true }))
    assertEquals(chosen, 0.125)
    slider.value = '1'
    slider.dispatchEvent(new window.Event('input', { bubbles: true }))
    assertEquals(button.disabled, true)
    document.querySelector<HTMLElement>('[data-do=frames]')!.dispatchEvent(
      new window.Event('click', { bubbles: true }),
    )
    assertEquals(frames.current, 30)
    settings.show()
    assertStringIncludes(
      document.body.textContent ?? '',
      '30 fps · lower power',
    )
  } finally {
    Object.assign(globalThis, {
      Element: element,
      HTMLInputElement: inputElement,
    })
  }
})
