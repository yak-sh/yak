import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import type { Comp } from '@yaks/graph'
import { mount } from '../tui/testing.ts'
import { until } from '../process/testing.ts'
import { App } from './app.ts'
import { frontend } from './frontend.ts'
import type { UIAgent } from './panels.ts'

Deno.test('P chooses a graph persona for a new session without changing the draft', async () => {
  let f = frontend()
  let started: { text: string; persona?: string }[] = []
  let a: UIAgent = {
    personas: () =>
      Promise.resolve([{
        entity: { eid: 'operator' },
        doc: { title: 'Operator' },
        persona: {},
      }]),
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    start: (text, options) => {
      started.push({ text, persona: options?.persona })
      return Promise.resolve('session')
    },
    send: () => Promise.resolve('entry'),
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
    line: () => '',
    entry: () => null,
  }
  let terminal = await mount(
    () => h(App, { agent: a, frontend: f, subscribe: () => () => {} }),
    110,
    30,
  )
  try {
    await terminal.send('keep this draft')
    await terminal.send('\x1b')
    await terminal.send('P')
    assertEquals(
      (f.client.ent('keyboard')!.keyboard as Comp).personas,
      true,
      terminal.text(),
    )
    await until(() => terminal.text().includes('Operator'), 'persona choices')
    await terminal.send('j')
    assertEquals(
      (f.client.ent('keyboard')!.keyboard as Comp).personaIndex,
      1,
      terminal.text(),
    )
    await terminal.send('\r')
    assertEquals(
      (f.client.ent('view')!.frontend as Comp).newPersona,
      'operator',
    )
    assertEquals((f.client.ent('draft')!.draft as Comp).text, 'keep this draft')
    assert(!(f.client.ent('keyboard')!.keyboard as Comp).personas)
    await terminal.send('i\r')
    await until(() => started.length == 1, 'new session')
    assertEquals(started, [{ text: 'keep this draft', persona: 'operator' }])
  } finally {
    terminal.free()
    await f.close()
  }
})
