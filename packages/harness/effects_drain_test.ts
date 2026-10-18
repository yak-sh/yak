// A draining native worker keeps its provider alive for a request already
// admitted, including a fresh connection after a reset. No request leaves here.
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import { effects } from './effects.ts'
import { seed } from './agent.ts'
import { at } from './testing.ts'

let observed = await (async () => {
  let config = at()
  config.plugins = config.plugins!.map((plugin) =>
    plugin == '@yaks/harness'
      ? { use: '@yaks/harness', facets: ['vocab', 'graph'] }
      : plugin
  )
  let host = await compose(config, ['graph', 'effects'])
  let started = Promise.withResolvers<void>()
  let release = Promise.withResolvers<void>()
  let fetched = 0, closed = 0
  let originalFetch = globalThis.fetch, originalEnv = Deno.env.get
  let fake: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/models')) {
      return Response.json({ data: [{ id: 'drain-model' }] })
    }
    fetched++
    let client = Reflect.get(init!, 'client')
    let close = client.close.bind(client)
    client.close = () => {
      closed++
      close()
    }
    if (fetched == 1) {
      started.resolve()
      await release.promise
      throw new TypeError('reset while draining')
    }
    return new Response(
      [
        {
          type: 'response.output_item.done',
          item: {
            type: 'message',
            content: [{ type: 'output_text', text: 'finished' }],
          },
        },
        {
          type: 'response.completed',
          response: { id: 'reply', model: 'drain-model', status: 'completed' },
        },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    )
  }
  // here() captures these capabilities synchronously. Restore the globals
  // before any asynchronous graph or provider work begins.
  globalThis.fetch = fake
  Deno.env.get = (name) =>
    name == 'OPENAI_API_KEY' ? 'fixture-key' : originalEnv(name)
  try {
    host.fx.handle(effects(host, { name: 'drain-model' }))
  } finally {
    globalThis.fetch = originalFetch
    Deno.env.get = originalEnv
  }
  let model = identityEid('model', ['drain-model'])
  let work: Promise<void> | undefined
  let ended = false
  try {
    await host.graph.apply([
      ...seed({ model: 'drain-model' }),
      {
        entity: { eid: model },
        model: { name: 'drain-model', context: 10000 },
      },
      { entity: { eid: 'session' }, session: {} },
      {
        entity: { eid: 'input' },
        entry: { session: 'session' },
        using: { model },
        content: { body: 'finish the admitted request' },
      },
    ], { trusted: true })
    let output = ''
    host.defer(async () => {
      let rows = await host.graph.read('.entry.session=session .output *')
      output = rows.map((row) => (row.content as Comp)?.body).join('')
    })
    work = host.fx.work(host.graph, host.stopping)
    await started.promise
    host.stop()
    let before = closed
    let closing = host.close()
    release.resolve()
    await closing
    ended = true
    await work
    return { before, closed, fetched, output }
  } finally {
    release.resolve()
    await work
    if (!ended) await host.close()
  }
})()

test('native worker drain retains a held model request through transport retry', () => {
  equal(observed, { before: 0, closed: 2, fetched: 2, output: 'finished' })
})
