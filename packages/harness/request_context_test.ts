// Native request preparation sends admitted inputs without consulting history.
import { equal, test } from '@yaks/testing'
import { type Comp, identityEid } from '@yaks/graph'
import type { Request } from '@yaks/model'
import { react } from '@yaks/session'
import { seed } from './agent.ts'
import { here } from './local.ts'
import { harness } from './testing.ts'

let observed = await (async () => {
  let h = await harness()
  let recalled = 0, searched = 0
  let host = {
    ...h,
    person: 'person',
    meaning: () => {
      recalled++
      return Promise.resolve([])
    },
  }
  let requests: Request[] = []
  let model = (req: Request) => {
    requests.push(req)
    return Promise.resolve({ id: 'fake', model: req.model, items: [] })
  }
  let { lent } = here(host, { model, tools: [], streaming: false })
  try {
    await h.g.apply([
      ...seed({ model: 'fake' }),
      { entity: { eid: 'person' }, doc: { title: 'Person' } },
      { entity: { eid: 'session' }, session: {} },
      {
        entity: { eid: 'input' },
        entry: { session: 'session' },
        content: { body: 'attachment files' },
        created: { by: 'person', at: '2026-10-19T00:00:00Z' },
        using: {
          provider: identityEid('provider', ['openai']),
          model: identityEid('model', ['fake']),
        },
      },
    ], { trusted: true })
    let read = h.g.read.bind(h.g)
    h.g.read = (q, ...args) => {
      if (typeof q == 'string' && q.includes('.created.at<')) searched++
      return read(q, ...args)
    }
    await react(h.g, 'session', {
      ...lent,
      model,
      tools: [],
      contextItems: lent.context,
      report: undefined,
    })
    let [input] = await h.g.get(['input'])
    return {
      recalled,
      searched,
      items: requests.map((req) => req.items),
      body: (input.content as Comp).body,
      snapshot: input.input_context,
    }
  } finally {
    await lent.release?.()
    await h.close()
  }
})()

test('native sending does not retrieve or persist historical recall', () => {
  equal(observed, {
    recalled: 0,
    searched: 0,
    items: [[{ kind: 'user', text: 'attachment files' }]],
    body: 'attachment files',
    snapshot: undefined,
  })
})
