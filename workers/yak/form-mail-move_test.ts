// The letters a form wrote before `form_mail`, and their addresses, move to it
// once; an app's own letter about a sign-up, and its address, are left alone.
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { formsDoc } from '@yaks/forms/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { mailDoc } from '@yaks/mail'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { lettered } from './form-mail.ts'
import { formMailRule } from './form-mail-move.ts'

let vocab = loadVocab([formsDoc, kernelDoc, mailDoc, docDoc])
let g = graph({ vocab, storage: ram(vocab) })
let sent = (purpose: string, to: string): Bundle[] => {
  let eid = lettered('signup', purpose, to)
  return [{ entity: { eid: eid.address }, email: { address: to } }, {
    entity: { eid: eid.letter },
    doc: { title: 'Tea', body: 'Thank you.' },
    mail: { target: 'signup' },
    deliver: { to: eid.address },
  }]
}
await g.apply([
  { entity: { eid: 'form' }, form: {} },
  { entity: { eid: 'signup' }, registration: { form: 'form', answers: {} } },
  ...sent('confirm', 'guest@example.com'),
  ...sent('notify', 'organizer@example.com'),
  { entity: { eid: 'staff' }, email: { address: 'staff@example.com' } },
  {
    entity: { eid: 'own' },
    mail: { target: 'signup' },
    deliver: { to: 'staff' },
  },
])
let move = async () => {
  let rows = await g.read(formMailRule.find)
  let read = (line: string) => g.storage.tx((tx) => tx.read(line)) as Bundle[]
  await g.apply(rows.flatMap((row) => formMailRule.move(row, read)))
  return (await g.read('.form_mail&?email')).map((r) => [
    (r.email as Comp | undefined)?.address ?? 'letter',
    (r.form_mail as Comp).purpose,
  ]).sort()
}

test("a form's earlier letters and addresses are kept with the sign-up, and the app's own are not", async () => {
  let moved = [
    ['guest@example.com', 'confirm'],
    ['letter', 'confirm'],
    ['letter', 'notify'],
    ['organizer@example.com', 'notify'],
  ]
  equal([await move(), await move()], [moved, moved])
})
