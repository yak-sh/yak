// Finding an app's newest walkthrough costs its own conversations, however
// much unrelated conversation history the space keeps.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { operatorDoc } from '@yaks/platform/operator-vocab'
import { provenanceDoc } from '@yaks/provenance'
import { storage } from '@yaks/sqlite'
import { seed, stepping } from '../../packages/sqlite/testing.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object' },
    session: { component: true, type: 'object' },
    created: provenanceDoc.$defs!.created,
    walkthrough: operatorDoc.$defs!.walkthrough,
  },
})
let { driver, steps } = stepping()
let store = storage(driver, vocab)
store.install()
let at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
seed(store, [
  {
    entity: { eid: 'older' },
    walkthrough: { app: 'garden' },
    created: { at: at(1) },
  },
  {
    entity: { eid: 'newer' },
    walkthrough: { app: 'garden' },
    created: { at: at(2) },
  },
  { entity: { eid: 'undated' }, walkthrough: { app: 'garden' } },
  ...Array.from({ length: 3000 }, (_, i) => ({
    entity: { eid: `other${i}` },
    session: {},
    created: { at: at(i + 3) },
    ...i < 20 ? { walkthrough: { app: 'recipes' } } : {},
  })),
])

for (let [app, expected] of [['garden', ['newer']], ['missing', []]] as const) {
  let query =
    `.walkthrough.app=${app}&?session&.order=-created.at&.limit=1&.fields=entity.eid`
  store.read(query)
  test(`the newest ${app} walkthrough reads only that app's candidates`, () => {
    let before = steps()
    let rows = store.read(query)
    let cost = steps() - before
    equal(rows.map((b) => b.entity.eid), [...expected])
    ok(cost < 2000, `${cost} VM steps`)
  })
}
