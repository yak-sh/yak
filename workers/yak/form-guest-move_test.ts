// The people and relations a sign-up created before `form_guest` move to it
// once; the app's own person, which the sign-up matched, is left alone.
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { formsDoc } from '@yaks/forms/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { signedUp } from './form-directory.ts'
import { formGuestRule } from './form-guest-move.ts'

let text = { type: 'string' }
let vocab = loadVocab([formsDoc, kernelDoc, {
  $defs: {
    individual: { component: true, properties: { first: text } },
    relation: { component: true, properties: { kind: text } },
  },
}])
let g = graph({ vocab, storage: ram(vocab) })
let questions = [
  { entity: { eid: 'form' }, form: {} },
  {
    entity: { eid: 'kids' },
    question: { form: 'form', kind: 'repeat', label: 'Kids' },
  },
  {
    entity: { eid: 'kid' },
    question: { form: 'form', kind: 'line', label: 'Kid', within: 'kids' },
  },
]
let answers = { kids: [{ kid: 'Sam' }] }
let [guest, child, link] = signedUp(
  'signup',
  { form: {}, questions: questions.slice(1) } as never,
  answers,
)
await g.apply([
  ...questions,
  { entity: { eid: 'signup' }, registration: { form: 'form', answers } },
  { entity: { eid: guest }, individual: { first: 'Zed' } },
  { entity: { eid: child }, individual: { first: 'Sam' } },
  { entity: { eid: link }, relation: { kind: 'parent' } },
  { entity: { eid: 'ann' }, individual: { first: 'Ann' } },
])
let move = async () => {
  let rows = await g.read(formGuestRule.find)
  let read = (line: string) => g.storage.tx((tx) => tx.read(line)) as Bundle[]
  await g.apply(rows.flatMap((row) => formGuestRule.move(row, read)))
  return (await g.read('.form_guest')).map((r) => r.entity.eid).sort()
}

test("a sign-up's earlier people and relations are kept with it, and the app's own are not", async () => {
  let moved = [guest, child, link].sort()
  equal([await move(), await move()], [moved, moved])
})
