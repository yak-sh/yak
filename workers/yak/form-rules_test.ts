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

test('a sign-up shared with the app writes its marked answers beside it, gone with it', async () => {
  await g.apply([
    {
      entity: { eid: 'prayer' },
      form: { shares: { question: 'with', is: 'Our church' } },
    },
    ...[['with', false], ['ask', true], ['email', false]].map(([eid, s]) => ({
      entity: { eid: String(eid) },
      question: { form: 'prayer', label: String(eid), kind: 'line', shared: s },
    })),
  ])
  let pray = (eid: string, answers: object) =>
    g.apply([{
      entity: { eid },
      registration: { form: 'prayer', answers, at: '2026-11-10T12:00:00Z' },
      completed: {},
    }])
  await pray('kept', { with: 'Just the team', ask: 'Quiet', email: 'a@b.c' })
  await pray('told', { with: 'Our church', ask: 'For Ann', email: 'a@b.c' })
  let rows = await g.read('.shared')
  equal(rows.map((r) => r.shared), [{
    form: 'prayer',
    registration: 'told',
    answers: { ask: 'For Ann' },
    at: '2026-11-10T12:00:00Z',
  }])
  await g.apply([{ entity: { eid: 'told' }, $delete: true }])
  equal(await g.read('.shared'), [])
})
