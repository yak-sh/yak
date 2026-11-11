// The addresses letters were written to before `recipient` are kept to the
// app's editors once; a staff address, and one no letter is for, are left alone.
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { kernelDoc } from '@yaks/kernel/vocab'
import { mailDoc } from '@yaks/mail'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { recipientRule } from './recipient-move.ts'

let vocab = loadVocab([
  kernelDoc,
  mailDoc,
  docDoc,
  { $defs: { individual: { component: true, type: 'object' } } },
])
let g = graph({ vocab, storage: ram(vocab) })
let to = (eid: string, more: Partial<Bundle> = {}): Bundle => ({
  entity: { eid },
  email: { address: `${eid}@example.com` },
  ...more,
})
await g.apply([
  to('guest'),
  to('staff', { individual: {} }),
  to('unwritten'),
  { entity: { eid: 'a' }, mail: {}, deliver: { to: 'guest' } },
  { entity: { eid: 'b' }, mail: {}, deliver: { to: 'staff' } },
])
let move = async () => {
  let rows = await g.read(recipientRule.find)
  let read = (line: string) => g.storage.tx((tx) => tx.read(line)) as Bundle[]
  await g.apply(rows.flatMap((row) => recipientRule.move(row, read)))
  return (await g.read('.recipient')).map((r) => r.entity.eid)
}

test("an address only a letter names is kept with the letters, and the app's own are not", async () => {
  equal([await move(), await move()], [['guest'], ['guest']])
})
