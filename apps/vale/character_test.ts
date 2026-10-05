// Both character panes stay usable together, including a live look preview.
import { equal, ok, test } from '@yaks/testing'
import { JSDOM } from 'npm:jsdom@26.1.0'
import { character } from './character.ts'
import { kitOf } from './gear.ts'
import { seedItems } from './items_fixture.ts'
import { HAIRS, type Look, SKINS, TINTS } from './make.ts'
import type { Sheet } from './play.ts'

let probe = (
  check: (p: {
    dom: JSDOM
    body: HTMLElement
    tab: { open: boolean }
    view: ReturnType<typeof character>
    look: Look
    sheet: Sheet
    saved: Look[]
    painted: Look[]
  }) => void,
) => {
  let dom = new JSDOM('<main></main>')
  let keys = ['document', 'HTMLElement', 'HTMLInputElement', 'Element']
  let prior = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  )
  for (let key of keys) {
    Object.defineProperty(globalThis, key, {
      value: Reflect.get(dom.window, key),
      configurable: true,
    })
  }
  try {
    let body = dom.window.document.querySelector<HTMLElement>('main')!
    let tab = {
      body,
      open: true,
      show() {},
      close() {},
      toggle() {},
    }
    let saved: Look[] = [], painted: Look[] = []
    let view = character(tab, {
      restyle: (look) => saved.push(look),
      typing: () => {},
      paint: (_, look) => painted.push({ ...look }),
    })
    let face = body.querySelector('canvas')!
    Object.defineProperty(face, 'clientWidth', { value: 104 })
    let look = {
      name: 'Wren',
      tint: TINTS[0],
      hair: HAIRS[0],
      skin: SKINS[0],
    }
    let sheet: Sheet = {
      name: 'Wren',
      xp: 0,
      lvl: 1,
      max: 100,
      bag: [],
      worn: {},
      kit: kitOf({}),
      firsts: [],
      abilities: [],
      learned: [],
      points: 0,
      quests: [],
      unpinned: new Set(),
    }
    view.show(sheet, look)
    check({ dom, body, tab, view, look, sheet, saved, painted })
  } finally {
    dom.window.close()
    keys.forEach((key, i) => {
      if (prior[i]) Object.defineProperty(globalThis, key, prior[i]!)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}

test('character and appearance remain visible while editing and reopening', () =>
  probe(({ dom, body, tab, view, look, sheet, saved, painted }) => {
    let face = body.querySelector('canvas')!
    let sections = [...body.querySelectorAll('section')]
    equal(sections.map((section) => section.getAttribute('aria-label')), [
      'Character',
      'Appearance',
    ])
    ok(sections.every((section) => !section.hidden))
    equal(body.querySelector('[data-select]'), null)
    ok(sections[0].contains(face))
    let input = body.querySelector<HTMLInputElement>('input')!
    ok(sections[1].contains(input))
    input.value = 'Bramble'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    view.show(sheet, look)
    equal(painted.at(-1)?.name, 'Bramble')
    tab.open = false
    view.show(sheet, look)
    tab.open = true
    view.show(sheet, look)
    equal(body.querySelector('input'), input)
    equal(input.value, 'Bramble')
    equal(body.querySelector('canvas'), face)
    body.querySelector('form')!.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    equal(saved, [{ ...look, name: 'Bramble' }])
  }))

test('character stats have icons and conditional stats follow equipped gear', () =>
  probe(({ body, view, look, sheet }) => {
    seedItems()
    let twin = { eid: 'a', kind: 'dagger1', n: 1 }
    let fast = {
      ...sheet,
      worn: {
        main: twin,
        off: { ...twin, eid: 'b' },
        feet: { eid: 'c', kind: 'boots1', n: 1 },
      },
    }
    for (let [s, extras] of [[sheet, []], [fast, ['twin', 'speed']]] as const) {
      view.show(s, look)
      for (
        let k of ['blow', 'pace', 'reach', 'armour', 'hp', 'luck', ...extras]
      ) {
        let line = body.querySelector(`.Stat-${k}`)!
        ok(line, `The ${k} stat is visible`)
        ok(line.querySelector('svg[aria-hidden=true]'), `${k} has a stat icon`)
        ok(line.textContent?.trim(), `${k} has its number and name`)
      }
      for (let k of ['twin', 'speed']) {
        equal(
          !!body.querySelector(`.Stat-${k}`),
          extras.some((extra) => extra == k),
        )
      }
    }
  }))
