import { assert } from '@std/assert'
import { h } from 'preact'
import { mount } from '../tui/testing.ts'
import { App, changes } from './app.ts'
import { frontend } from './frontend.ts'
import { local } from './local.ts'
import { until } from '../process/testing.ts'
import { harness, repo } from './testing.ts'

Deno.test('mounted transcript paints partial markdown before the model returns', async () => {
  let release!: () => void
  const wait = new Promise<void>((r) => release = r)
  const a = local({
    cwd: repo(),
    h: await harness(),
    streaming: true,
    model: async (req) => {
      req.onText?.({ index: 0, text: '**partial** response' })
      await wait
      return {
        id: 'r',
        model: 'fake',
        items: [{ kind: 'assistant', text: '**partial** response' }],
      }
    },
  })
  const ui = frontend()
  let term: Awaited<ReturnType<typeof mount>> | undefined
  try {
    const id = await a.start('hello')
    ui.patch({ selected: id })
    term = await mount(
      () => h(App, { agent: a, subscribe: changes(a), frontend: ui }),
      100,
      20,
    )
    await until(
      () => term!.text().includes('partial'),
      'partial response paint',
    )
    assert(term.text().includes('response'))
    release()
    await a.idle(id)
  } finally {
    release()
    term?.free()
    ui.client.close()
    await a.close()
  }
})
