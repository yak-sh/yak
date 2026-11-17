import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { grafted, sessionDoc, sessions } from './mod.ts'
import { transcript } from './transcript.ts'
import { project } from './project.ts'

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
let store = () => graph({ storage: ram(vocab), vocab, plugins: [sessions()] })

// A demo's transcript in its own store: a request, the ask that answered it
// with a call and the call's result, and the reply.
let demo = store()
await demo.apply([
  { entity: { eid: 'demo' }, session: {} },
  {
    entity: { eid: 'said' },
    entry: { session: 'demo' },
    content: { body: 'A guestbook' },
  },
  {
    entity: { eid: 'asked' },
    entry: { session: 'demo' },
    ask: { through: 'said' },
  },
  {
    entity: { eid: 'call' },
    entry: { session: 'demo' },
    call: { id: 'tu_1', name: 'app_deploy', args: {}, source: 'asked' },
  },
  {
    entity: { eid: 'done' },
    entry: { session: 'demo' },
    result: { call: 'call' },
    content: { body: 'v1' },
  },
  {
    entity: { eid: 'reply' },
    entry: { session: 'demo' },
    output: { source: 'asked' },
    content: { body: 'Made it.' },
  },
])
let lines = await transcript(demo, 'demo')

test('a grafted transcript is the beginning of a session in another store, read as the original is', async () => {
  let g = store()
  await g.apply([
    { entity: { eid: 'mine' }, session: {} },
    ...grafted(lines, 'mine'),
    {
      entity: { eid: 'next' },
      entry: { session: 'mine' },
      content: { body: 'Add photos' },
    },
  ])
  let mine = await transcript(g, 'mine')
  assertEquals(
    mine.map((b) =>
      (b.content as { body?: string })?.body ?? Object.keys(b).at(-1)
    ),
    ['A guestbook', 'ask', 'call', 'v1', 'Made it.', 'Add photos'],
  )
  let had = project(lines, lines, new Map())
  assertEquals(project(mine, mine, new Map()).slice(0, had.length), had)
  // Given again, the same rows.
  await g.apply(grafted(lines, 'mine'))
  assertEquals((await transcript(g, 'mine')).length, mine.length)
})
