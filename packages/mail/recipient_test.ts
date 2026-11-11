import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { mailDoc } from './comp.ts'
import { recipients } from './recipient.ts'

let vocab = loadVocab([
  mailDoc,
  { $defs: { individual: { component: true, type: 'object' } } },
])
let marked = async (...batches: Bundle[][]) => {
  let g = graph({ storage: ram(vocab), vocab, plugins: [recipients()] })
  for (let batch of batches) await g.apply(batch)
  return (await g.read('.recipient')).map((b) => b.entity.eid)
}
let address = (eid: string): Bundle => ({
  entity: { eid },
  email: { address: `${eid}@example.com` },
})
let letter: Bundle = { entity: { eid: 'l' }, mail: {}, deliver: { to: 'a' } }

test('an address written with its letter, or before it, is marked', async () => {
  equal(await marked([address('a'), letter]), ['a'])
  equal(await marked([address('a')], [letter]), ['a'])
})

test('an address no letter is for is not marked', async () => {
  equal(await marked([address('a')]), [])
})

test('a write that names no address is applied and checked without waiting', () => {
  let g = graph({ storage: ram(vocab), vocab, plugins: [recipients()] })
  let note: Bundle = { entity: { eid: 'n' }, mail: {} }
  equal(g.apply([note]) instanceof Promise, false)
  equal(g.admit([note]) instanceof Promise, false)
})

test('an address the app also gave something of its own is not marked', async () => {
  let staff = { ...address('a'), individual: {} }
  equal(await marked([staff, letter]), [])
  equal(await marked([address('a'), letter], [{ ...staff }]), ['a'])
})
