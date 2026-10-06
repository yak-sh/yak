// A selected skill has the same icon plate and stat lines as gear,
// while learning still respects points and the preceding skill.
import { assertEquals, assertMatch } from '@std/assert'
import { test } from '@yaks/testing'
import { withDom } from './dom_fixture.ts'
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
  withDom((_, body) => {
    let actions: string[] = []
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
  })
}

test('the selected skill heads its page with its icon plate and title, like gear', () => {
  for (let id of ['brawn', 'fleet', 'kindness']) {
    selected(id, [], 5, (body) => {
      let skill = SKILLS[id], head = body.querySelector('.Tile-head')!
      assertEquals(head.querySelector('.Tile_Title')?.textContent, skill.name)
      assertMatch(
        head.querySelector('.Tile_Sub')!.textContent!,
        new RegExp(DISCIPLINES[skill.discipline].name),
      )
      assertEquals(head.querySelectorAll('.Tile_Icon .Glyph').length, 1)
      if (skill.ability) {
        let detail = body.querySelector('.Split_Content')!
        assertEquals(
          detail.querySelectorAll('.Section_Title > [aria-hidden] .Glyph')
            .length,
          1,
        )
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
