import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { formsDoc } from '@yaks/forms/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { mailDoc } from '@yaks/mail'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { formPost } from './form-mail.ts'

let vocab = loadVocab([formsDoc, kernelDoc, mailDoc, docDoc])
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'app' }, doc: { title: 'App' } },
  {
    entity: { eid: 'form' },
    form: { thanks: 'Thank you.', notify: ['organizer'] },
  },
  {
    entity: { eid: 'email' },
    question: {
      form: 'form',
      label: 'Email',
      kind: 'line',
      fills: 'individual.email',
    },
  },
  { entity: { eid: 'organizer' }, email: { address: 'organizer@example.com' } },
  {
    entity: { eid: 'signup' },
    registration: { form: 'form', answers: { email: 'guest@example.com' } },
    completed: {},
  },
])
let send = formPost({ app: 'app', graph: g })
let retry = () =>
  send(
    { kind: 'created', entity: { eid: 'signup' }, name: 'completed', comp: {} },
    g.storage,
    (b) => g.apply(b),
  )

test('retrying sign-up delivery keeps the first letters and their bodies', async () => {
  await retry()
  let first = await g.read('.mail&?doc&?deliver')
  equal(first.length, 2)
  equal(first.some((row) => (row.doc as Comp)?.body == 'Thank you.'), true)
  await retry()
  equal(await g.read('.mail&?doc&?deliver'), first)
})
