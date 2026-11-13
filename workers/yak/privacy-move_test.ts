// An app store holding entities from before it kept their privacy is given
// each one's by the pass, and then read by it: a draft and the pages of a
// private document stay their person's, and a second pass finds nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { personal } from '@yaks/member'
import { appVocab } from './vocab.ts'
import { privacyRules } from './privacy-move.ts'
import { THROUGH } from './config.ts'
import type { Query } from '@yaks/query'

let vocab = appVocab({})
let g = graph({ vocab, storage: ram(vocab) })
let [ana, bo] = [crypto.randomUUID(), crypto.randomUUID()]
let [draft, doc, page, open] = Array.from(
  { length: 4 },
  () => crypto.randomUUID(),
)
await g.apply([
  { entity: { eid: ana }, person: {} },
  { entity: { eid: bo }, person: {} },
  { entity: { eid: draft }, draft: { by: ana, place: 'p', text: 'mine' } },
  { entity: { eid: doc }, draft: { by: ana, place: 'q', text: 'scan' } },
  { entity: { eid: page }, document_page: { document: doc, page: 1 } },
  { entity: { eid: open }, document_page: { document: ana, page: 2 } },
], { trusted: true })
g.use(personal(vocab, {}, THROUGH))
let rules = privacyRules(vocab)
let seen = async (person: string) =>
  (await g.read('.draft|.document_page', { person })).map((b) => b.entity.eid)
    .sort()

let read = (line: string | Query) => {
  let got = g.read(line)
  if (got instanceof Promise) throw new Error('ram reads at once')
  return got
}
let found = () => rules.flatMap((rule) => read(rule.find))

test('the privacy pass gives every entity from before its privacy, and the store is read by it', async () => {
  let before = { ana: await seen(ana), bo: await seen(bo) }
  assertEquals(
    found().map((r) => r.entity.eid).sort(),
    [draft, doc, page, open].sort(),
  )
  for (let rule of rules) {
    await g.apply(
      read(rule.find).flatMap((row) => rule.move(row, read)),
      { trusted: true },
    )
  }
  assertEquals(found(), [])
  assertEquals({ ana: await seen(ana), bo: await seen(bo) }, before)
  assertEquals(before.ana, [draft, doc, page, open].sort())
  assertEquals(before.bo, [open])
})
