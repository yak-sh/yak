// The chat's first write is one atomic move: retire the selected binding,
// spawn the replacement Session on the first prompt, and bind it.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals, assertThrows } from '@std/assert'
import { h } from 'preact'
import { cache, ent } from '../live.ts'
import { mount } from './mount.ts'
import { ORACLE } from '@yaks/topic'
import type { Ent } from '../types.ts'
import { chatChanges, chatPlan, Starter, voiceOf } from './Chat.tsx'

test('a human chat opens a taskless session and rebinds the chat', () => {
  let got = chatChanges(
    'old',
    'next',
    'actor',
    'target',
    { provider: 'p', model: 'm' },
    'What changed?',
  )
  let entry = got.find((c) => c.name == 'entry')!.eid
  assertEquals(got, [
    { eid: 'old', name: 'chat', comp: null },
    { eid: 'next', name: 'session', comp: { operator: true } },
    { eid: entry, name: 'entry', comp: { session: 'next' } },
    { eid: entry, name: 'content', comp: { body: 'What changed?' } },
    { eid: entry, name: 'using', comp: { provider: 'p', model: 'm' } },
    { eid: 'next', name: 'chat', comp: { actor: 'actor', target: 'target' } },
  ])
})

test('a chat on a persona opens a native session wearing it', () => {
  let got = chatChanges(
    undefined,
    'next',
    'actor',
    'oracle',
    { provider: 'p' },
    'What do you look after?',
    { persona: 'oracle' },
  )
  assertEquals(got.slice(0, 2), [
    {
      eid: 'next',
      name: 'session',
      comp: { operator: true, persona: 'oracle' },
    },
    { eid: 'next', name: 'native', comp: {} },
  ])
  assertEquals(got.at(-1), {
    eid: 'next',
    name: 'chat',
    comp: { actor: 'actor', target: 'oracle' },
  })
})

test('a chat on a topic opens a native session on it, wearing the oracle', () => {
  let topic = { eid: 'data', topic: { name: 'data' } } as unknown as Ent
  let got = chatChanges(
    undefined,
    'next',
    'actor',
    'data',
    { provider: 'p' },
    'What is an entity?',
    voiceOf(topic),
  )
  assertEquals(got.slice(0, 2), [
    {
      eid: 'next',
      name: 'session',
      comp: { operator: true, persona: ORACLE, topic: 'data' },
    },
    { eid: 'next', name: 'native', comp: {} },
  ])
})

test('chatPlan picks a graph-native provider', () => {
  let ps = [
    {
      name: 'codex',
      models: ['gpt'],
      labels: { gpt: 'GPT' },
      efforts: { gpt: ['low', 'medium'] },
    },
    { name: 'codex-cli', models: ['gpt'], fallback: true },
  ]
  assertEquals(chatPlan(ps, () => false), {
    provider: 'codex',
    model: 'gpt',
    effort: 'medium',
  })
  assertThrows(
    () => chatPlan(ps, (name) => name == 'codex'),
    Error,
    'No graph-native chat model is available',
  )
})

// What a new chat's line invites, and how it is drawn, for a row of each kind:
// each mounted once, at load.
let invited = (row: Record<string, unknown>) => {
  cache.value = { it: { entity: { eid: 'it', num: 9 }, ...row } }
  let mounted = mount(h(Starter, { e: ent('it'), actor: 'actor', done() {} }))
  try {
    let box = mounted.root.querySelector('textarea.Field')
    return [box?.getAttribute('placeholder'), box?.getAttribute('class')]
  } finally {
    mounted.free()
    cache.value = {}
  }
}
let titled = (title: string) => ({ doc: { eid: 'it', title, body: '' } })
let invites = {
  document: invited(titled('A very long document title')),
  persona: invited({ ...titled('Oracle of yaks'), persona: { eid: 'it' } }),
  topic: invited({
    ...titled('Data model'),
    topic: { eid: 'it', name: 'data model' },
  }),
}

test('a new chat reuses the composer input with a terse prompt', () => {
  assertEquals(invites.document, ['start a chat…', 'Field'])
})

test('a chat on a persona messages it by name', () => {
  assertEquals(invites.persona[0], 'message Oracle of yaks…')
})

test('a chat on a topic asks about it by name', () => {
  assertEquals(invites.topic[0], 'ask about Data model…')
})
