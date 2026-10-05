import { assertEquals, assertMatch, assertNotMatch } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { seedAbilities } from './abilities_fixture.ts'
import { seedItems } from './items_fixture.ts'
import { numbers } from './compare.ts'
import { skillDetail } from './skill-detail.ts'

let hero = (kind = 'hammer1', learned: string[] = []) => ({
  lvl: 5,
  learned,
  worn: { main: { eid: 'weapon', kind, n: 1 } },
})

test('skill bonuses use the same named stat colors and icons as gear', () => {
  seedItems()
  for (
    let [id, stats] of [
      ['brawn', [['hp', '+10% Health']]],
      ['heft', [['force', '+12% Attack bonus']]],
      ['hide', [['armour', '+25% Armor']]],
      ['momentum', [['haste', '+12% Attack speed bonus']]],
      ['nimble', [['speed', '+8% Speed'], ['luck', '+5% Critical chance']]],
    ] as [string, [string, string][]][]
  ) {
    let { document } = parseHTML(skillDetail(hero(), id))
    for (let [stat, text] of stats) {
      let row = document.querySelector(`.Pack_Rolled .Stat-${stat}`)
      assertEquals(row?.textContent?.trim(), text, `${id}: ${stat}`)
      assertEquals(row?.querySelectorAll('svg.Glyph').length, 1, id)
    }
  }
})

test('skill details show bonuses and the hero changes with current gear', () => {
  seedItems()
  let s = hero(), hp = numbers(s, s.worn).hp
  assertMatch(skillDetail(s, 'brawn'), /\+10% Health/)
  assertMatch(
    skillDetail(s, 'brawn'),
    new RegExp(`Health ${hp} → .*${Math.round(hp * 1.1)}`),
  )
  assertMatch(skillDetail(s, 'heft'), /Attack .* → .*Pack_Up/)
  assertMatch(
    skillDetail(hero('sword1'), 'heft'),
    /No listed hero stats change/,
  )
  assertMatch(
    skillDetail(hero('hammer1', ['heft']), 'heft'),
    /\+12% Attack bonus/,
  )
  assertNotMatch(
    skillDetail(hero('hammer1', ['heft']), 'heft'),
    /If learned| → /,
  )
  assertMatch(
    skillDetail(hero('hammer1', ['heft', 'aftershock']), 'momentum'),
    /Attack interval .* → .*Pack_Up/,
  )
})

test('skill details compare ability effects and cooldowns without changing the hero', () => {
  seedItems()
  seedAbilities()
  let s = hero('tome1'), hp = numbers(s, s.worn).hp
  let card = skillDetail(s, 'kindness')
  assertMatch(
    card,
    new RegExp(
      `Restores ${Math.round(hp * 0.3)} Health.*→.*Restores ${
        Math.round(hp * 0.45)
      } Health`,
    ),
  )
  assertMatch(skillDetail(s, 'bulwark'), /Cooldown .*→ If learned.*Cooldown/)
  assertMatch(skillDetail(s, 'earthbreaker'), /1\.5 s Stun/)
  assertNotMatch(skillDetail(hero('tome1', ['kindness']), 'kindness'), / → /)
  assertNotMatch(card, /Health \d+ → /)
  assertMatch(skillDetail(hero('dagger1'), 'twin'), /Allows a second Dagger/)
  assertNotMatch(skillDetail(hero('dagger1'), 'twin'), /Current|→ If learned/)
})
