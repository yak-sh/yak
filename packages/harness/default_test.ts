// A session that names no model asks the offering the router chooses among
// those the harness routes, and records why; one that names a model keeps it.
import { equal, test } from '@yaks/testing'
import type { Model } from '@yaks/model'
import { type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { HARNESS, usingFor } from './default.ts'
import { seed } from './agent.ts'
import { local } from './local.ts'
import { harness } from './testing.ts'

let P = (name: string) => identityEid('provider', [name])
let M = (name: string) => identityEid('model', [name])

test('the default is the routed offering whose plan has the most usage left', async () => {
  let h = await harness()
  let asked: string[] = []
  let fake = (provider: string): Model => (request) => {
    asked.push(`${provider} ${request.model}`)
    return Promise.resolve({
      id: 'r' + asked.length,
      model: request.model,
      items: [{ kind: 'assistant', text: 'ok' }],
    })
  }
  let a = await local({
    h,
    providers: { openai: fake('openai'), claude: fake('claude') },
  })
  let week = (provider: string, used: number) => ({
    entity: { eid: provider + '-week' },
    rate_limit: {
      provider: P(provider),
      window: 10080,
      used,
      resets: '2999-01-01T00:00:00.000Z',
    },
  })
  // The first input of a session started with `o`: what it asks and why.
  let start = async (o?: { model: string }) => {
    let s = await a.start('hello', o)
    await a.idle(s)
    let [input] = await h.g.read(`.entry.session=${s}&.using&!ask&*`)
    let [ask] = await h.g.read(`.entry.session=${s}&.ask&*`)
    // The ask records what was served, and the reason stays on the input.
    equal(ask.using, {
      provider: (input.using as Comp).provider,
      model: (input.using as Comp).model,
    })
    return (input.using as Comp).why
  }
  try {
    await h.g.apply([
      ...seed({ provider: 'openai', model: 'sol' }),
      ...seed({ provider: 'claude', model: 'opus' }),
      ...seed({ provider: 'codex', model: 'sol' }),
      // openai, signed in with the ChatGPT grant, spends the plan codex reads.
      { entity: { eid: P('openai') }, provider: { plan: P('codex') } },
      link(HARNESS, 'routes', link(P('openai'), 'serves', M('sol')).entity.eid),
      link(
        HARNESS,
        'routes',
        link(P('claude'), 'serves', M('opus')).entity.eid,
      ),
    ], { trusted: true })
    // No plan has a reading: the harness's own `using` answers.
    equal(await start(), undefined)
    await h.g.apply([week('claude', 84), week('codex', 82)], { trusted: true })
    equal(
      await start(),
      'sol has 18% of its week left, opus has 16% of its week left',
    )
    await h.g.apply([week('codex', 90)], { trusted: true })
    equal(
      await start(),
      'opus has 16% of its week left, sol has 10% of its week left',
    )
    equal(await start({ model: M('sol') }), undefined)
    // A project routes its own work, whatever the harness's default reads.
    await h.g.apply([
      { entity: { eid: 'p' }, project: {}, doc: { title: 'Project' } },
      link('p', 'routes', link(P('openai'), 'serves', M('sol')).entity.eid),
    ], { trusted: true })
    equal(await usingFor(h.g, 'p'), {
      provider: P('openai'),
      model: M('sol'),
      why: 'sol has 10% of its week left',
    })
    equal(asked.map((line) => line.split(' ')[1]).slice(1), [
      'sol',
      'opus',
      'sol',
    ])
  } finally {
    await a.close()
  }
})
