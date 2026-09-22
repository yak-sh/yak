import type { Comp } from '@yaks/graph'
import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { mount } from '../tui/harness.ts'
import { until } from '../process/harness.ts'
import { App, changes } from './app.ts'
import { frontend } from './frontend.ts'
import { open } from './store.ts'
import { agent, seed } from './run.ts'
import { edgeEid } from '@yaks/edge'
import { identityEid } from '@yaks/graph'
import type { Request } from '@yaks/model'

Deno.test('m chooses a model for a new draft; existing choice is passive, Esc preserves draft', async () => {
  const hnd = open(':memory:')
  const requests: Request[] = []
  const a = agent({
    h: hnd,
    model: (req) => {
      requests.push(req)
      return Promise.resolve({
        id: 'r',
        model: req.model,
        items: [{ kind: 'assistant', text: 'ok' }],
      })
    },
  })
  await hnd.g.apply(seed({ provider: 'openrouter', model: 'a/model' }))
  const ui = frontend()
  const terminal = await mount(
    () => h(App, { agent: a, subscribe: changes(a), frontend: ui }),
    110,
    30,
  )
  try {
    await terminal.send('my draft')
    await terminal.send('\x1bm') // alt-m does not steal text
    await terminal.send('\x1b')
    await terminal.send('m')
    await until(() => terminal.text().includes('a/model'), 'model choices')
    assert(terminal.text().includes('Enter choose'))
    await terminal.send('\r')
    await until(
      () => !(ui.client.ent('keyboard')!.keyboard as Comp).models,
      'model chosen',
    )
    assertEquals(
      (ui.client.ent('view')!.frontend as Comp).newModel,
      edgeEid(
        identityEid('provider', ['openrouter']),
        'serves',
        identityEid('model', ['a/model']),
      ),
    )
    assertEquals(requests.length, 0)
    await terminal.send('i')
    await terminal.send('\r')
    await until(() => requests.length == 1, 'request')
    assertEquals(requests[0].model, 'a/model')
    await until(
      () => !!(ui.client.ent('view')!.frontend as Comp).selected,
      'session selected',
    )
    await a.idle(String((ui.client.ent('view')!.frontend as Comp).selected))
    await terminal.send('untouched')
    await terminal.send('\x1b')
    await terminal.send('m')
    await until(() => terminal.text().includes('Enter choose'), 'reopen')
    await terminal.send('j')
    await terminal.send('\x1b')
    assertEquals((ui.client.ent('draft')!.draft as Comp).text, 'untouched')
    assertEquals(requests.length, 1)
    await terminal.send('m')
    await terminal.send('j\r')
    await until(
      () => !(ui.client.ent('keyboard')!.keyboard as Comp).models,
      'switch model',
    )
    assertEquals(requests.length, 1)
  } finally {
    terminal.free()
    await ui.close()
    await a.close()
  }
})

Deno.test('model row mouse selection preserves INSERT and does not submit a draft', async () => {
  const hnd = open(':memory:')
  let requests = 0
  const a = agent({
    h: hnd,
    model: (req) => {
      requests++
      return Promise.resolve({ id: 'r', model: req.model, items: [] })
    },
  })
  const ui = frontend()
  const terminal = await mount(
    () => h(App, { agent: a, subscribe: changes(a), frontend: ui }),
    110,
    30,
  )
  try {
    await terminal.send('keep me')
    ui.keys({ models: true })
    await until(
      () => terminal.text().includes('○ ') || terminal.text().includes('● '),
      'choices',
    )
    const lines = terminal.text().split('\n')
    const y = lines.findIndex((l) =>
      l.includes('gpt-6-astra') && (l.includes('○ ') || l.includes('● '))
    )
    assert(y >= 0)
    const x = Math.max(0, lines[y].indexOf('gpt-6-astra'))
    await terminal.send(
      '\x1b[<0;' + (x + 1) + ';' + (y + 1) + 'M\x1b[<0;' + (x + 1) + ';' +
        (y + 1) + 'm',
    )
    await until(
      () => !(ui.client.ent('keyboard')!.keyboard as Comp).models,
      'clicked',
    )
    assertEquals((ui.client.ent('draft')!.draft as Comp).text, 'keep me')
    assertEquals((ui.client.ent('keyboard')!.keyboard as Comp).mode, 'INSERT')
    assertEquals(requests, 0)
  } finally {
    terminal.free()
    await ui.close()
    await a.close()
  }
})
