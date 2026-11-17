// The two newcomers an agent's check opened are marked `test` once; every
// other newcomer, and one whose client is already said, is left alone.
import { line } from '@yaks/query'
import { equal, test } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { directoryDoc } from '@yaks/platform/directory-vocab'
import { checkNewcomerRule, CHECKS } from './check-newcomer-move.ts'

let vocab = loadVocab([kernelDoc, {
  $defs: { newcomer: directoryDoc.$defs!.newcomer },
}])
let at = '2026-11-10T20:47:35.338Z'
let rows = [
  { entity: { eid: CHECKS[0] }, newcomer: { at, campaign: '' } },
  { entity: { eid: CHECKS[1] }, newcomer: { at, campaign: '', client: 'bot' } },
  { entity: { eid: mint() }, newcomer: { at, campaign: '' } },
]
let storage = ram(vocab)
storage.tx((tx) => tx.patch(rows))
let g = graph({ vocab, storage })
let move = async () => {
  let found = await g.read(checkNewcomerRule.find)
  let patches = found.flatMap((row) => checkNewcomerRule.move(row))
  await g.apply(patches, { trusted: true })
  return patches.length
}

test("an agent's check's newcomers are marked test once, and nobody else", async () => {
  equal([await move(), await move()], [1, 0])
  let clients = await Promise.all(
    rows.map(async (r) =>
      (await g.read(line`.entity.eid=${r.entity.eid}&.newcomer`))[0].newcomer
    ),
  )
  equal(clients.map((n) => (n as { client?: string }).client), [
    'test',
    'bot',
    undefined,
  ])
})
