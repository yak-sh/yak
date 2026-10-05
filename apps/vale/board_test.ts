// A selected skill has the same icon plate and named-stat display as gear,
// while learning still respects points and the preceding skill.
import { assertEquals, assertMatch } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { seedAbilities } from './abilities_fixture.ts'
import { board } from './board.ts'
import { kitOf } from './gear.ts'
import { seedItems } from './items_fixture.ts'
import type { Sheet } from './play.ts'
import { DISCIPLINES, SKILLS } from './skills.ts'

let selected = (
  id: string,
  learned: string[],
  lvl: number,
  check: (body: HTMLElement, actions: string[]) => void,
) => {
  seedItems()
  seedAbilities()
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
  })
  try {
    let body = document.querySelector('main')!, actions: string[] = []
    let view = board({ body, open: true, show() {}, close() {}, toggle() {} }, {
      learn: (skill) => actions.push(skill),
      respec() {},
    })
    let sheet: Sheet = {
      name: 'Wren',
      xp: 0,
      lvl,
      max: 100,
      bag: [],
      worn: {},
      kit: kitOf({}),
      firsts: [],
      abilities: [],
      learned,
      points: lvl - learned.length,
      quests: [],
      unpinned: new Set(),
    }
    let frame = { sheet, rack: false } as Parameters<typeof view.show>[0]
    view.show(frame)
    body.querySelector<HTMLElement>(`[data-skill=${id}]`)!.click()
    view.show(frame)
    check(body, actions)
  } finally {
    if (prior) Object.defineProperty(globalThis, 'Element', prior)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
}

test('the selected skill shows a discipline-colored icon plate and title like gear', () => {
  for (let id of ['brawn', 'fleet', 'kindness']) {
    selected(id, [], 5, (body) => {
      let skill = SKILLS[id], card = body.querySelector('.Pack_Card')!
      assertEquals(
        card.classList.contains(`Board_Discipline-${skill.discipline}`),
        true,
      )
      assertEquals(card.querySelector('.Board_Name')?.textContent, skill.name)
      assertMatch(
        card.querySelector('.Board_Kind')!.textContent!,
        new RegExp(DISCIPLINES[skill.discipline].name),
      )
      assertEquals(card.querySelectorAll('.Pack_Big .Glyph').length, 1)
      if (skill.ability) {
        assertEquals(body.querySelectorAll('.Board_Ability .Glyph').length, 1)
      }
    })
  }
})

test('the selected skill offers learning only with its prerequisite and a point', () => {
  for (
    let [id, learned, lvl, action, hint] of [
      ['brawn', [], 1, true, ''],
      ['hide', [], 2, false, 'Needs Brawn first.'],
      ['hide', ['brawn'], 2, true, ''],
      ['fleet', ['brawn'], 1, false, 'No points left.'],
      ['brawn', ['brawn'], 2, false, 'Learned.'],
    ] as [string, string[], number, boolean, string][]
  ) {
    selected(id, learned, lvl, (body, actions) => {
      let learn = body.querySelector<HTMLElement>('[data-do=learn]')
      assertEquals(!!learn, action, id)
      if (learn) {
        learn.click()
        assertEquals(actions, [id])
      } else {
        assertEquals(actions, [])
        assertEquals(
          body.querySelector('.Split_Content')!.textContent!.includes(hint),
          true,
          hint,
        )
      }
    })
  }
})
