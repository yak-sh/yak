// The menu lets a player compare ground detail at a deliberate reload, with
// the selected size and its cost visible before applying it.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { withDom } from './dom_fixture.ts'
import { menu, type Settings } from './menu.ts'
import type { Panel } from './panel.ts'

test('menu sections show icons and keep their rows while settings change', () =>
  withDom(({ document, window }) => {
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
    let rows = [...document.querySelectorAll<HTMLElement>('[data-select]')]
    assertEquals(rows.map((row) => row.textContent), [
      'Audio',
      'Display',
      'Controls',
      'Touch',
      'Keys',
    ])
    assertEquals(
      rows.every((row) => row.querySelector('.Glyph') != null),
      true,
    )
    for (let row of rows) {
      assertEquals(
        row.querySelector('svg')!.getAttribute('aria-hidden'),
        'true',
      )
    }
    rows[1].dispatchEvent(new window.Event('click', { bubbles: true }))
    assertEquals(rows.map((row) => row.getAttribute('aria-current')), [
      'false',
      'true',
      'false',
      'false',
      'false',
    ])
    assertEquals(document.querySelector('[data-section=audio]'), null)
    assertEquals(!!document.querySelector('[data-section=display]'), true)
    assertEquals(document.querySelector('[data-select=audio]'), rows[0])
    let slider = document.querySelector<HTMLInputElement>('[data-voxel]')!
    let button = document.querySelector<HTMLButtonElement>('[data-do=voxel]')!
    let choice = document.querySelector('[data-voxel-choice]')!
    let cost = () => document.querySelector<HTMLElement>('[data-voxel-cost]')
    assertEquals(choice.textContent, '0.25 m')
    assertEquals(button.disabled, true)
    assertEquals(cost(), null)
    slider.value = '0'
    slider.dispatchEvent(new window.Event('input', { bubbles: true }))
    assertEquals(choice.textContent, '0.125 m')
    assertEquals(button.disabled, false)
    assertStringIncludes(cost()?.textContent ?? '', 'four times')
    assertEquals(chosen, null)
    button.dispatchEvent(new window.Event('click', { bubbles: true }))
    assertEquals(chosen, 0.125)
    slider.value = '1'
    slider.dispatchEvent(new window.Event('input', { bubbles: true }))
    assertEquals(button.disabled, true)
    let rates = () =>
      [...document.querySelectorAll<HTMLElement>('[data-do=frames]')].map((
        b,
      ) => [b.textContent, b.getAttribute('aria-pressed')])
    assertEquals(rates(), [['60 fps', 'true'], ['30 fps', 'false']])
    document.querySelectorAll<HTMLElement>('[data-do=frames]')[1]
      .dispatchEvent(new window.Event('click', { bubbles: true }))
    assertEquals(frames.current, 30)
    settings.show()
    assertEquals(rates(), [['60 fps', 'false'], ['30 fps', 'true']])
  }, '<html><body></body></html>'))
