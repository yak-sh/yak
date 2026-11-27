import { assertEquals } from '@std/assert'
import { type Comp, mint } from '@yaks/graph'
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { investigatorOf } from './operator-escalate.ts'
import { operatorMemory } from './operator-testing.ts'
import { platform } from './testing.ts'
import { stamp } from './directory.ts'
import { meta } from './meta.ts'
import { spendBackfill, SPENT_PEOPLE } from './spend-move.ts'

let p = platform('spend people')
let NOW = Date.parse('2026-11-27T12:00:00Z')

// Each Operator ask's dollars go under the person its conversation works
// for, a compaction's under the conversation it compacts, an investigation's
// under nobody, and the days live spends already name are left as they say.
test("an Operator's asks before spends named a person are kept under each conversation's person, once", async () => {
  let space = mint()
  let session = (person: string) => ({
    entity: { eid: mint() },
    session: {},
    operator_session: { person, space },
  })
  let [JEFF, TOG] = [mint(), mint()]
  let jeff = session(JEFF), tog = session(TOG)
  let looked = session(investigatorOf(space))
  let compacting = { entity: { eid: mint() }, session: { source: mint() } }
  let from = mint()
  let ask = (of: { entity: { eid: string } }, dollars: number, at: string) => ({
    entity: { eid: mint() },
    entry: { session: of.entity.eid },
    ask: {},
    cost: { dollars },
    created: { at },
  })
  let { g } = operatorMemory()
  await g.apply([
    jeff,
    tog,
    looked,
    { entity: { eid: from }, entry: { session: jeff.entity.eid } },
    {
      entity: { eid: compacting.session.source },
      call: { source: from },
    },
    compacting,
    ask(jeff, 1, '2026-11-20T10:00:00Z'),
    ask(compacting, 0.5, '2026-11-20T11:00:00Z'),
    ask(tog, 2, '2026-11-21T10:00:00Z'),
    ask(looked, 4, '2026-11-21T10:00:00Z'),
    ask(tog, 8, '2026-11-27T10:00:00Z'),
    ask(tog, 16, '2026-10-01T10:00:00Z'),
  ], { trusted: true })
  await stamp(p.env, {
    entities: [{
      entity: { eid: space },
      space: { slug: 'spent-' + space, store: space },
      trend: {
        spend: { '2026-11-20': 1.5, '2026-11-21': 6, '2026-11-27': 9 },
        people: { [TOG]: { '2026-11-27': 1 } },
      },
    }],
  })
  let kept = new Map<string, string>()
  let marks = { get: (k: string) => kept.get(k), set: kept.set.bind(kept) }
  let store = { g, marks }
  assertEquals(await spendBackfill(store, p.env, NOW), false)
  assertEquals(kept.get(SPENT_PEOPLE), 'done')
  let people = async () =>
    ((await meta(p.env).query(line`.entity.eid=${space}`))[0].trend as Comp)
      ?.people
  let want = {
    [JEFF]: { '2026-11-20': 1.5 },
    [TOG]: { '2026-11-21': 2, '2026-11-27': 1 },
  }
  assertEquals(await people(), want)
  await spendBackfill(store, p.env, NOW)
  assertEquals(await people(), want)
})
