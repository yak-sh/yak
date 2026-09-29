// Encounters through the same creature, kit, and combat rules the game uses.
import { assert } from '@std/assert'
import { ITEMS } from './items.ts'
import { foeOf, landLevel, skull } from './danger.ts'
import { kitOf } from './gear.ts'
import { dens } from './homes.ts'
import { HOPS, LEVELS } from './levels.ts'
import { GIVERS, QUESTS, questXp } from './quests.ts'
import {
  biteOf,
  blowOf,
  levelOf,
  maxHp,
  need,
  questsOf,
  xpOf,
} from './rules.ts'
import { skilled } from './skills.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let wear = (lvl: number, tier: number, full: boolean, known: string[]) => {
  let kinds = full
    ? ['sword', 'shield', 'helm', 'cuirass', 'greaves']
    : ['sword']
  let worn = Object.fromEntries(kinds.map((name) => {
    let kind = `${name}${tier}`
    return [ITEMS[kind].slot!, { eid: kind, kind, n: 1 }]
  }))
  return skilled(kitOf(worn), known, maxHp(lvl))
}

let encounter = (
  lvl: number,
  kit: ReturnType<typeof wear>,
  kind: string,
  land: string,
) => {
  let foe = foeOf(kind, land)
  let health = maxHp(lvl) + kit.hp
  let bite = biteOf(foe.dmg, foe.lvl, lvl, kit.armour)
  return {
    foe,
    bites: Math.ceil(health / bite),
    blows: Math.ceil(foe.hp / blowOf(lvl, kit)),
    killTime: foe.hp / blowOf(lvl, kit) * kit.pace / 1000,
    surviveTime: health / bite * 1.5,
  }
}

Deno.test('every land has encounters on the level-one-to-sixty path', () => {
  let lands = Object.values(LEVELS)
  for (let lv of lands) {
    let foes = [...new Set(dens(lv).map((d) => d.kind))]
      .map((kind) => foeOf(kind, lv.id))
    assert(foes.length > 0, lv.id)
    assert(
      foes.every((b) => b.lvl >= landLevel(HOPS[lv.id]) && b.lvl <= 60),
      lv.id,
    )
  }
  assert(foeOf('cinderwyrm', 'maw').lvl == 60)
})

Deno.test('outward roads get riskier, and skipping two lands is fatal', () => {
  for (let land of Object.values(LEVELS)) {
    let hops = HOPS[land.id]
    if (!hops) continue
    let hero = landLevel(Math.max(0, hops - 1)) + 2
    let foes = [...new Set(dens(land).map((d) => d.kind))]
      .filter((kind) => {
        let b = foeOf(kind, land.id)
        return b.aggro > 0 && !b.boss
      })
    let geared = wear(hero, Math.min(5, Math.ceil(hero / 12)), true, [])
    assert(
      foes.some((kind) => encounter(hero, geared, kind, land.id).bites <= 7),
      land.id,
    )
    if (hops < 2) continue
    let under = landLevel(hops - 2) + 2
    let bare = wear(under, 1, false, [])
    assert(
      foes.some((kind) => encounter(under, bare, kind, land.id).bites == 1),
      land.id,
    )
  }
})

Deno.test('equipment and a friend turn the next land from fatal to possible', () => {
  let lvl = 17
  let bare = wear(lvl, 1, false, [])
  let geared = wear(lvl, 2, true, ['brawn', 'hide', 'keen'])
  let home = encounter(lvl, geared, 'bear', 'clovermead')
  let ahead = encounter(lvl, geared, 'direwolf', 'wolfden')
  let unready = encounter(lvl, bare, 'direwolf', 'wolfden')
  let distant = encounter(lvl, bare, 'frostwolf', 'frostmoor')
  assert(home.bites > ahead.bites)
  assert(unready.bites <= 2 && unready.killTime > unready.surviveTime)
  assert(ahead.bites >= 3 && ahead.killTime > ahead.surviveTime * 0.7)
  assert(ahead.killTime / 2 < ahead.surviveTime * 0.6)
  assert(distant.bites == 1 && skull(distant.foe.lvl, lvl))
  assert(!skull(ahead.foe.lvl, lvl))
})

Deno.test('the final boss asks more of a hero than the best plain kit', () => {
  let lvl = 60
  let kit = wear(lvl, 5, true, [])
  let boss = encounter(lvl, kit, 'cinderwyrm', 'maw')
  assert(boss.killTime > boss.surviveTime)
  assert(boss.killTime / 2 < boss.surviveTime)
})

Deno.test('saved awards retain their value while new lands reward their level', () => {
  let quest = QUESTS.find((q) =>
    HOPS[q.level ?? GIVERS.find((g) => g.id == q.giver)?.level ?? ''] == 8
  )!
  let done = { quest: quest.id, step: 'done', at: 1 }
  assert(xpOf([], [quest], [done]) == quest.xp)
  assert(questXp(quest) > quest.xp)
  assert(xpOf([], [quest], [{ ...done, xp: questXp(quest) }]) == questXp(quest))
  assert(questsOf([quest], [done], [], [])[0].award == quest.xp)
  assert(
    questsOf([quest], [{ ...done, xp: questXp(quest) }], [], [])[0].award ==
      questXp(quest),
  )
  let old = { creature: 'a', by: 'p', kind: 'wolf', at: 1, xp: 200 }
  let raised = { ...old, lvl: foeOf('wolf', 'birchmere').lvl }
  let seed = { ...quest, id: 'seed', xp: need(7) }
  let before = [{ quest: 'seed', step: 'done', at: 0 }]
  assert(xpOf([raised], [seed], before) > xpOf([old], [seed], before))
  assert(levelOf(need(61)) == 60)
})
