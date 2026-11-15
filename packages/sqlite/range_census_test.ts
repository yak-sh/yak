// A component's page within a range of an indexed property reads the range
// when it holds fewer rows than the component, sized by both its bounds.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { seed, stepping } from './testing.ts'

let comp = (properties = {}, index?: string[][]) => ({
  component: true,
  type: 'object',
  properties,
  ...index ? { index } : {},
})
let vocab = loadVocab({
  $defs: {
    entity: comp(),
    usage: comp({ tokens: { type: 'number' } }),
    bookmark: comp(),
    created: comp({ at: { type: 'string', format: 'date-time' } }, [['at']]),
  },
})
let { driver, steps } = stepping()
let s = storage(driver, vocab)
s.install()
let at = (day: number, i: number) =>
  new Date(Date.UTC(2026, 0, day, 0, 0, i)).toISOString()
let rows = (n: number, kind: 'usage' | 'bookmark', day: number) =>
  Array.from({ length: n }, (_, i) => ({
    entity: { eid: `${kind}${day}-${i}` },
    [kind]: kind == 'usage' ? { tokens: 1 } : {},
    created: { at: at(day, i) },
  }))
// Each bound alone holds more rows than there are usages: every day before
// the 2nd, or every day from the 2nd on. Between them, the 2nd holds five.
seed(s, [
  ...rows(3000, 'usage', 1),
  ...rows(3000, 'bookmark', 1),
  ...rows(5, 'usage', 2),
  ...rows(4000, 'bookmark', 3),
])

for (
  let q of [
    `.usage .created.at>=${at(2, 0)} .created.at<${at(3, 0)}`,
    `.usage .created.at<${at(3, 0)} .created.at>=${at(2, 0)}`,
  ]
) {
  let line = `${q} .order=entity.eid .limit=3`
  test(`${line} reads its day, not every usage`, async () => {
    await s.rows(line)
    let start = steps(), page = await s.rows(line)
    let read = steps() - start
    equal(page.map((r) => r.eid), ['usage2-0', 'usage2-1', 'usage2-2'])
    ok(read < 3000, `${read} VM steps`)
  })
}
