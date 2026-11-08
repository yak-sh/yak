import { type Bundle, graph } from '@yaks/graph'
import { formsDoc } from '@yaks/forms/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { mailDoc } from '@yaks/mail'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { equal, test, throws } from '@yaks/testing'
import { formRules } from './form-rules.ts'

let vocab = loadVocab([formsDoc, kernelDoc, mailDoc, docDoc])
let store = storage(durable(), vocab)
store.install()
let g = graph({
  vocab,
  storage: store,
  plugins: [formRules(() => 1000)],
})
await g.apply([{ entity: { eid: 'form' }, form: { capacity: 1 } }])
let sign = (eid: string): Bundle => ({
  entity: { eid },
  registration: { form: 'form', answers: {} },
  completed: {},
})

test('capacity refuses an entire batch and retains its place after rollback', async () => {
  await throws(() => g.apply([sign('one'), sign('two')]), 'closed or full')
  equal(await g.read('.registration'), [])
  let out = g.apply([sign('one')])
  equal(out instanceof Promise, false)
  await out
  await throws(() => g.apply([sign('two')]), 'closed or full')
  equal((await g.read('.registration')).length, 1)
})
