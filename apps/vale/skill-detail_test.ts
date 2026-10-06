import { assertEquals, assertMatch, assertNotMatch } from '@std/assert'
import { test } from '@yaks/testing'
import { seedAbilities } from './abilities_fixture.ts'
import { drawn } from './dom_fixture.ts'
import { seedItems } from './items_fixture.ts'
import { numbers } from './compare.ts'
import { skillDetail } from './skill-detail.ts'

let hero = (kind = 'hammer1', learned: string[] = []) => ({
  lvl: 5,
  learned,
  worn: { main: { eid: 'weapon', kind, n: 1 } },
})
type Hero = ReturnType<typeof hero>
// The skill's page, its words, and its line starting `name`, if any.
let page = (s: Hero, id: string) => drawn(skillDetail(s, id))
let text = (s: Hero, id: string) => page(s, id).textContent!
let line = (s: Hero, id: string, name: string) =>
  [...page(s, id).querySelectorAll('.ValeStats_Stat')].find((l) =>
    l.textContent!.startsWith(name)
  )

test('skill bonuses read in ink with the icons gear uses', () => {
  seedItems()
  for (
    let [id, stats] of [
      ['brawn', ['+10% Health']],
      ['heft', ['+12% Attack bonus']],
      ['hide', ['+25% Armor']],
      ['momentum', ['+12% Attack speed bonus']],
      ['nimble', ['+8% Speed', '+5% Critical chance']],
    ] as [string, string[]][]
  ) {
    for (let words of stats) {
      let row = line(hero(), id, words)
      assertEquals(row?.textContent, words, id)
      assertEquals(row?.querySelectorAll('svg.Glyph').length, 1, id)
      assertEquals(row?.querySelector('em'), null, id)
    }
  }
})

test('skill details show bonuses and the hero changes with current gear', () => {
  seedItems()
  let s = hero(), hp = numbers(s, s.worn).hp
  assertMatch(text(s, 'brawn'), /\+10% Health/)
  assertMatch(
    text(s, 'brawn'),
    new RegExp(`Health ${hp} → ${Math.round(hp * 1.1)}`),
  )
  assertEquals(
    !!line(s, 'heft', 'Attack ')?.querySelector('.ValeStats_Better'),
    true,
  )
  assertMatch(text(hero('sword1'), 'heft'), /No listed hero stats change/)
  let known = hero('hammer1', ['heft'])
  assertMatch(text(known, 'heft'), /\+12% Attack bonus/)
  assertNotMatch(text(known, 'heft'), /If learned| → /)
  assertEquals(
    !!line(
      hero('hammer1', ['heft', 'aftershock']),
      'momentum',
      'Attack interval',
    )
      ?.querySelector('.ValeStats_Better'),
    true,
  )
})

test('skill details compare ability effects and cooldowns without changing the hero', () => {
  seedItems()
  seedAbilities()
  let s = hero('tome1'), hp = numbers(s, s.worn).hp
  assertMatch(
    text(s, 'kindness'),
    new RegExp(
      `Restores ${Math.round(hp * 0.3)} → ${Math.round(hp * 0.45)} Health`,
    ),
  )
  assertEquals(
    !!line(s, 'bulwark', 'Cooldown')?.querySelector('.ValeStats_Better'),
    true,
  )
  assertMatch(text(s, 'earthbreaker'), /1\.5 s Stun/)
  assertNotMatch(text(hero('tome1', ['kindness']), 'kindness'), / → /)
  assertNotMatch(text(s, 'kindness'), /Health \d+ → /)
  assertMatch(text(hero('dagger1'), 'twin'), /Allows a second Dagger/)
  assertNotMatch(text(hero('dagger1'), 'twin'), /now → if learned| → /)
})
