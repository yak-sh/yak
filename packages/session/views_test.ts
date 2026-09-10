import { assert, assertEquals } from '@std/assert'
import { render } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { views } from './views.ts'

let vocab = loadVocab(sessionDoc)
let body = 'x'.repeat(100) + '\nchild final output'
let entry = {
  entity: { eid: 'e' },
  entry: { session: 's', seq: 1 },
  content: { body },
}

Deno.test('Line full retains multiline prose; the default stays a compact preview', () => {
  let compact = render(views, entry, 'Line', vocab, {}, 'plain')
  let full = render(views, entry, 'Line', vocab, { full: true }, 'plain')
  assert(compact.endsWith('x'.repeat(70)))
  assertEquals(compact.includes('child final output'), false)
  assert(full.endsWith(body))
})

Deno.test('Body omits metadata but retains resolved target and full prose', () => {
  let call = { ...entry, call: { to: 'tool' } }
  assertEquals(
    render(views, call, 'Body', vocab, {
      full: true,
      names: { tool: 'shell' },
    }, 'plain'),
    '→ shell ' + body,
  )
  assertEquals(
    render(
      views,
      entry,
      'Body',
      vocab,
      { full: true },
      'plain',
    ),
    body,
  )
})
