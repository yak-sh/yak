// Routing an effect and checking process ownership need no transcript accounting.
// Refusing reads of computed session bundles exposes accidental accounting.
import { assertEquals } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { processDoc } from '@yaks/process'
import { loadVocab, pick } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { test } from '@yaks/testing'
import { sessionDoc } from './comp.ts'
import { running } from './run.ts'

let vocab = loadVocab([
  pick(sessionDoc, [
    'session',
    'entry',
    'ask',
    'using',
    'fork',
    'claim',
    'stop',
    'session_release',
  ]),
  pick(processDoc, ['process', 'exit']),
])
let base = ram(vocab, { computed: { 'session.status': () => 'stopped' } })
let seed = graph({ storage: base, vocab })
seed.apply([
  { entity: { eid: 'root' }, session: {} },
  { entity: { eid: 'input' }, entry: { session: 'root' }, using: {} },
  { entity: { eid: 'ask' }, entry: { session: 'root' }, ask: {} },
  { entity: { eid: 'imported' }, session: {} },
  { entity: { eid: 'fork' }, session: {}, fork: { from: 'input' } },
  { entity: { eid: 'old-ask' }, entry: { session: 'imported' }, ask: {} },
  { entity: { eid: 'managed' }, session: {}, process: { pid: 123 } },
  { entity: { eid: 'managed-work' }, claim: { session: 'managed' } },
  { entity: { eid: 'stopped' }, session: {} },
  { entity: { eid: 'stop' }, entry: { session: 'stopped' }, stop: {} },
  { entity: { eid: 'stopped-work' }, claim: { session: 'stopped' } },
], { trusted: true })
let get = base.get
let read = base.read
let g = graph({
  vocab,
  storage: {
    ...base,
    get: (eids, comps) => {
      if (!comps || comps.includes('session')) {
        throw new Error('Transcript accounting is unavailable')
      }
      return get(eids, comps)
    },
    read: (query, opts, comps) => {
      let found = read(query, opts, comps)
      if (
        !comps && found.some((b) => (b.entry as Comp)?.session == 'imported')
      ) {
        throw new Error('The complete transcript is unavailable')
      }
      return found
    },
  },
})

let event = (eid: string) => ({
  kind: 'matched' as const,
  entity: { eid },
  name: 'session',
})
let runner = () => {
  let providers: unknown[] = []
  let handlers = running(g, {
    holder: 'worker',
    tools: [],
    model: () => Promise.reject(new Error('No model should run')),
    answers: (using) => {
      providers.push(using)
      return false
    },
  })
  let run = (name: string, eid: string) =>
    handlers[name](event(eid), g.outside, (b) => g.apply(b))
  return { run, providers, handlers }
}

test('session routing answers empty session identities without accounting', async () => {
  let r = runner()
  await r.run('session_run', 'root')
  await r.run('session_run', 'input')
  await r.run('session_run', 'ask')
  assertEquals(r.providers, [{}, {}])
})

test('a hosted receipt owes its ask session a run without transcript accounting', async () => {
  let r = runner()
  await r.handlers.session_run(
    {
      kind: 'changed',
      name: 'inference',
      entity: { eid: 'ask' },
      comp: { receipt: 'private-receipt' },
    },
    g.outside,
    (b) => g.apply(b),
  )
  assertEquals(r.providers, [{}])
})

test('an imported transcript routes an ask without loading its history', async () => {
  let r = runner()
  await r.run('session_run', 'imported')
  assertEquals(r.providers, [undefined])
})

test('a fork without a local provider inherits its parent selection', async () => {
  let r = runner()
  await r.run('session_run', 'fork')
  assertEquals(r.providers, [{}])
})

test('release keeps a running process claim without transcript accounting', async () => {
  await runner().run('session_release', 'managed-work')
  assertEquals((await g.get(['managed-work'], ['claim']))[0].claim, {
    session: 'managed',
  })
})

test('release drops a stopped session claim without transcript accounting', async () => {
  await runner().run('session_release', 'stopped')
  assertEquals((await g.get(['stopped-work'], ['claim']))[0].claim, undefined)
})
