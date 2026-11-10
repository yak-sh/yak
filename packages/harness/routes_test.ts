// A model step another host forwards is answered here, through the server a
// `yak` config composes: the tunnel's filter in front, this machine's
// providers behind. The forwarding host is @yaks/model/step's own, asking the
// composed handler the way a tunnel's gateway does.
import { compose } from '@yaks/cli/host'
import { edgeEid } from '@yaks/edge'
import { identityEid } from '@yaks/graph/identity'
import type { Plug } from '@yaks/host'
import { type Model, ModelError } from '@yaks/model'
import { forwarding, PATH } from '@yaks/model/step'
import { equal, test } from '@yaks/testing'
import { HEADER } from '@yaks/tunnel'

// A provider that says who it is, in two pieces.
let stub = (name: string): Model => (request) => {
  request.onText?.({ index: 0, text: name })
  request.onText?.({ index: 0, text: ` as ${request.model}` })
  return Promise.resolve({
    id: 'r1',
    model: request.model,
    items: [{ kind: 'assistant', text: `${name} as ${request.model}` }],
  })
}

// A machine whose config names two providers, `kept` and `lent`, each serving
// one model under a name of its own, with the step path open to its tunnel.
let machine = async (serve?: string[]) => {
  let harness: Plug = {
    use: '@yaks/harness',
    with: {
      ...serve ? { serve } : {},
      providers: { kept: stub('kept'), lent: stub('lent') },
    },
  }
  let host = await compose({
    db: ':memory:',
    plugins: [
      '@yaks/kernel',
      '@yaks/id',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/task',
      '@yaks/session',
      '@yaks/provenance',
      '@yaks/model',
      '@yaks/api',
      { use: '@yaks/tunnel', with: { routes: [PATH] } },
      harness,
    ],
  }, ['graph', 'web'])
  await host.graph.apply(
    ['kept', 'lent'].flatMap((name) => {
      let provider = identityEid('provider', [name])
      let model = identityEid('model', [`${name}-model`])
      return [
        { entity: { eid: provider }, provider: { name } },
        { entity: { eid: model }, model: { name: `${name}-model` } },
        {
          entity: { eid: edgeEid(provider, 'serves', model) },
          edge: { from: provider, to: model },
          serves: { name: `${name}-1` },
        },
      ]
    }),
    { trusted: true },
  )
  // The other host, reaching this one the way the tunnel's gateway does.
  let through = forwarding({
    fetch: async (at, init) => {
      let headers = new Headers(init?.headers)
      headers.set(HEADER, '1')
      return await host.handler!(new Request(at, { ...init, headers }))
    },
  })
  let ask = async (model: string) => {
    let text = ''
    let reply = await through({
      model,
      items: [{ kind: 'user', text: 'Who answers?' }],
      tools: [],
      onText: (delta) => text += delta.text,
    })
    return [text, reply.items]
  }
  return { host, ask }
}

// What each machine answered, asked once as the file loads.
let coded = (ask: Promise<unknown>) =>
  ask.then(() => 'answered', (error) => (error as ModelError).code)

let serving = await (async () => {
  let { host, ask } = await machine(['lent'])
  try {
    return {
      lent: await ask('lent-model'),
      kept: await coded(ask('kept-model')),
      // The rest of the machine stays closed to the tunnel.
      apply: (await host.handler!(
        new Request('http://machine/apply', {
          method: 'POST',
          headers: { [HEADER]: '1' },
          body: '[]',
        }),
      )).status,
    }
  } finally {
    await host.close()
  }
})()

let silent = await (async () => {
  let { host, ask } = await machine()
  try {
    return await coded(ask('lent-model'))
  } finally {
    await host.close()
  }
})()

test('a step through the tunnel is answered by a provider the config serves, streamed', () => {
  equal(serving.lent, [
    'lent as lent-1',
    [{ kind: 'assistant', text: 'lent as lent-1' }],
  ])
})

test('a provider the config does not serve answers no step', () => {
  equal(serving.kept, 'provider')
})

test('opening the step path opens nothing else to the tunnel', () => {
  equal(serving.apply, 403)
})

test('a config that serves no provider answers no step', () => {
  equal(silent, 'unreachable')
})
