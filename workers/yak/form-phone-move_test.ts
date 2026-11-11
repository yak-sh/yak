import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { formsDoc } from '@yaks/forms/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { phoneDoc } from '@yaks/phone'
import { loadVocab } from '@yaks/vocab'
import { memberKeywords, personal } from '@yaks/member'
import { equal, test } from '@yaks/testing'
import { texterEid } from './form-phone.ts'
import { formPhoneRule } from './form-phone-move.ts'

let vocab = loadVocab([formsDoc, kernelDoc, phoneDoc, docDoc], [memberKeywords])
let g = graph({ vocab, storage: ram(vocab), plugins: [personal(vocab)] })
await g.apply([
  { entity: { eid: 'form' }, form: {} },
  ...['guest', 'staff', 'unconsented'].map((eid): Bundle => ({
    entity: { eid },
    doc: { title: eid },
  })),
  ...['guest', 'staff', 'unconsented'].flatMap((submitter): Bundle[] => [{
    entity: { eid: submitter + '-signup' },
    registration: { form: 'form', submitter },
  }]),
  {
    entity: { eid: 'guest-again' },
    registration: { form: 'form', submitter: 'guest' },
  },
  { entity: { eid: texterEid('guest') }, phone: { number: '+12695550142' } },
  { entity: { eid: 'app-phone' }, phone: { number: '+12695550143' } },
])
let original = await g.get(['app-phone'])
let numbers = async (person: string | null, level?: string) =>
  (await g.read('.phone', { person, level })).map((row) =>
    (row.phone as Comp).number
  ).sort()
let move = async () => {
  let rows = await g.read(formPhoneRule.find)
  let read = (line: string) => g.storage.tx((tx) => tx.read(line)) as Bundle[]
  for (let row of rows) await g.apply(formPhoneRule.move(row, read))
}

test('the mover keeps earlier form-created phones to editors, once, and leaves app-owned phones unchanged', async () => {
  equal(await numbers(null), ['+12695550142', '+12695550143'])
  await move()
  equal(await numbers(null), ['+12695550143'])
  equal(await numbers('reader', 'viewer'), ['+12695550143'])
  equal(await numbers('reader', 'editor'), ['+12695550142', '+12695550143'])
  let first = await g.read('.form_phone')
  equal(first.length, 1)
  await move()
  equal(await g.read('.form_phone'), first)
  equal(await g.get(['app-phone']), original)
})
