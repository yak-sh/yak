import { clock, equal, ok, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { preparedDriver, snapshot } from './testing.ts'

let vocab = loadVocab([{
  $defs: {
    note: { component: true, properties: { text: { type: 'string' } } },
  },
}])
let base = preparedDriver(snapshot(vocab))
let locked = true
let driver = {
  ...base,
  file: true,
  query: (s: Parameters<typeof base.query>[0]) => {
    if (s.t == 'begin' && locked) throw new Error('database is locked')
    return base.query(s)
  },
}
let time = clock()
let store = storage(driver, vocab, { schemaReady: () => true, clock: time })

test('storage transactions await a writer before starting their callback', async () => {
  let bodies = 0
  try {
    let error = assertThrows(() => store.tx(() => ++bodies, { wait: false }))
    equal((error as Error & { retryable?: boolean }).retryable, true)
    equal(bodies, 0)
    let pending = store.tx((tx) => {
      bodies++
      tx.patch([{ entity: { eid: 'committed' }, note: { text: 'one' } }])
      return 42
    })
    ok(pending instanceof Promise)
    equal(bodies, 0)
    locked = false
    await time.advance(5)
    equal(await pending, 42)
    equal(bodies, 1)
    equal(store.get(['committed'])[0].note, { text: 'one' })
    equal(store.tx(() => 17), 17)
  } finally {
    base[Symbol.dispose]()
  }
})
