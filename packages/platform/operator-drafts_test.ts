import { equal, test, until } from '@yaks/testing'
import { browserDrafts } from '@yaks/draft/browser'
import { draftEid } from '@yaks/draft'
import {
  draftRows,
  draftStore,
  operatorDrafts,
  operatorWrite,
} from './operator-drafts.ts'
import { graph } from './page-graph_fixture_test.ts'

let ADA = 'person-ada'
let SPACE = 'space-home'
let PLACE = 'operator:talk'

let row = (text: string, rev: number) => ({
  entity: { eid: draftEid(ADA, PLACE) },
  draft: { by: ADA, place: PLACE, text, rev },
})

let desk = () => {
  let g = graph((b) =>
    Promise.resolve(
      b.map((x) => ({ ...x, draft: { ...x.draft as object, rev: 2 } })),
    )
  )
  let drafts = browserDrafts(draftStore(g, SPACE, ADA), `${SPACE}:operator`, {
    by: ADA,
    stash: false,
    pace: 0,
    line: () => operatorDrafts(SPACE),
  })
  return { g, drafts }
}

test('a desk on the page graph hears the space’s drafts on its line, and writes them marked with the space', async () => {
  let { g, drafts } = desk()
  g.set(operatorDrafts(SPACE), draftRows(SPACE, [row('From the phone', 1)]))
  equal(drafts.text(PLACE), 'From the phone')
  drafts.type(PLACE, 'From the phone, and here')
  await until(() => g.wrote.length > 0)
  equal(
    g.wrote[0].map((b) => [
      (b.draft as { text: string }).text,
      b.operatorDraft,
    ]),
    [['From the phone, and here', { space: SPACE }]],
  )
  equal(operatorWrite(g.wrote[0])?.space, SPACE)
  drafts.close()
})

test('a write is sent to one space’s store only when every bundle names it', () => {
  let one = draftRows(SPACE, [row('a', 1)])
  equal(operatorWrite(one)?.bundles, [row('a', 1)])
  equal(
    operatorWrite([...one, ...draftRows('elsewhere', [row('b', 1)])]),
    undefined,
  )
  equal(operatorWrite([row('a', 1)]), undefined)
})
