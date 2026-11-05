// A runner lent `wear` says each transcript's persona at the top of every ask,
// its base read from where bases are kept, and what the host adds after it,
// read again each ask, so an edit reaches a transcript on its next turn.
import { equal, test } from '@yaks/testing'
import { link } from '@yaks/edge'
import type { Request } from '@yaks/model'
import { agent, begin } from './agent.ts'
import { harness } from './testing.ts'

let h = await harness()
let bases = await harness()
let persona = (eid: string, body: string, base?: string) => ({
  entity: { eid },
  persona: base ? { base } : {},
  doc: { title: eid, body },
})
await bases.g.apply([persona('platform', 'Every space hears this.')])
await h.g.apply([
  persona('space', 'The space says this.', 'platform'),
  { entity: { eid: 'name' }, doc: { title: 'name', body: 'You are Elihu.' } },
  link('space', 'contains', 'name'),
])
let asked: Request[] = []
let a = agent({
  h,
  name: 'fake',
  model: (req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: 'fake',
      items: [{ kind: 'assistant', text: 'ok' }],
    })
  },
  wear: { bases: bases.g.storage },
  instructions: () => Promise.resolve('Where it is: two apps.'),
})
let session = await begin(h.g, 'hello', {
  persona: 'space',
  using: { model: a.model },
})
await a.idle(session)
let first = asked.at(-1)!.instructions
await bases.g.apply([persona('platform', 'Every space hears this now.')])
await a.send(session, 'again')
await a.idle(session)
let second = asked.at(-1)!.instructions
await a.close()

// The lines with words in them: each heading and body, without the rules.
let heads = (text?: string) =>
  String(text).split('\n').filter((l) => /\w/.test(l))

test('an ask says the base, the persona, what it contains, then what the host adds', () => {
  equal(heads(first), [
    '# #platform platform',
    'Every space hears this.',
    '# #space space',
    'The space says this.',
    '# #name name',
    'You are Elihu.',
    'Where it is: two apps.',
  ])
})

test("a change to the base reaches the transcript's next ask", () => {
  equal(heads(second)[1], 'Every space hears this now.')
})
