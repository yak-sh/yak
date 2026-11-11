import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { mailDoc } from './vocab.ts'
import { receipted } from './receipts.ts'

let vocab = loadVocab([docDoc, mailDoc])
let g = graph({ vocab, storage: ram(vocab) })
let sent = crypto.randomUUID(), deleted = crypto.randomUUID()
let raced = crypto.randomUUID(), absent = crypto.randomUUID()
let simultaneous = crypto.randomUUID()
await g.apply([sent, deleted, raced, simultaneous].map((eid) => ({
  entity: { eid },
  mail: { from: 'hello@example.com' },
})))
await g.apply([{ entity: { eid: deleted }, tombstone: {} }])
let receipt = (letter: string, id = 'sent@example.com') => ({ letter, id })
let [before] = await g.get([simultaneous])

test('a delivery receipt fills its letter once and refuses a conflicting Message-ID', async () => {
  await receipted(g, receipt(sent))
  await receipted(g, receipt(sent))
  equal((await g.get([sent]))[0].mail, {
    from: 'hello@example.com',
    message_id: 'sent@example.com',
  })
  await assertRejects(
    () => receipted(g, receipt(sent, 'another@example.com')),
    Error,
    'disagrees with the recorded Message-ID',
  )
})

test('a delivery receipt for a deleted letter acknowledges it without restoring it', async () => {
  await receipted(g, receipt(deleted))
  equal((await g.get([deleted]))[0].tombstone, {})
})

test('concurrent delivery receipts for the same Message-ID settle without conflict', async () => {
  let graph = { get: () => [before], apply: g.apply }
  await Promise.all([
    receipted(graph, receipt(simultaneous)),
    receipted(graph, receipt(simultaneous)),
  ])
  equal((await g.get([simultaneous]))[0].mail, {
    from: 'hello@example.com',
    message_id: 'sent@example.com',
  })
})

test('a delivery receipt for an unknown letter still waits for its record', async () => {
  await assertRejects(
    () => receipted(g, receipt(absent)),
    Error,
    'awaits its recorded letter',
  )
  equal(await g.get([absent]), [])
})

test('a receipt racing a letter deletion leaves the letter deleted', async () => {
  await receipted({
    get: g.get,
    apply: async (bundles, opts) => {
      await g.apply([{ entity: { eid: raced }, tombstone: {} }])
      return await g.apply(bundles, opts)
    },
  }, receipt(raced))
  let [row] = await g.get([raced])
  equal(row.tombstone, {})
  equal(row.mail, undefined)
})
