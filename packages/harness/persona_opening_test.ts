// A session any door writes as data (a browser's chat: the session, the
// persona it wears, the topic it is opened on, its first message) opens with
// no copy of its persona: each ask is told the persona's text and the topic's
// tree afresh, and offered the tools the persona contains then
// (./wear_test.ts).
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { begin } from './agent.ts'
import { effects } from './effects.ts'
import { openingFor } from './instructions.ts'
import { at } from './testing.ts'

let opened = await (async () => {
  let host = await compose(at(), ['graph'])
  let g = host.graph
  let handlers = effects(host)
  let provider = identityEid('provider', ['openai'])
  let yaks = 'yaks'
  let begun = (session: string, persona?: string, topic?: string) => [
    { entity: { eid: session }, session: { operator: true, persona, topic } },
    {
      entity: { eid: session + '-said' },
      entry: { session },
      using: { provider, effort: 'high' },
      content: { body: 'What do you look after?' },
    },
  ]
  let persona = (eid: string, body: string) => ({
    entity: { eid },
    persona: {},
    doc: { title: eid, body },
  })
  try {
    await g.apply([
      { entity: { eid: provider }, provider: { name: 'openai' } },
      persona('oracle', 'Tend the topic of yaks.'),
      persona('farmer', 'Tend the topic of barns.'),
      persona('base', 'Every farmer hears this.'),
      link('farmer', 'contains', 'base'),
      {
        entity: { eid: yaks },
        topic: { name: 'yaks' },
        doc: { title: 'Yaks', body: 'What belongs under yaks.' },
        content: { body: 'A yak is a bovid.' },
      },
      ...begun('worn', 'oracle'),
      ...begun('plain'),
      ...begun('topical', 'oracle', yaks),
    ], { trusted: true })
    for (let session of ['worn', 'worn', 'plain', 'topical']) {
      // No default model is installed, so the opening is tested without a
      // paid ask: the step ends saying so.
      await handlers.session_run(
        { entity: { eid: session + '-said' } } as never,
        g,
        {} as never,
        {} as never,
      )
    }
    // A command line's `session new --persona` opens the same way, by begin.
    let command = await begin(g, undefined, {
      ...await openingFor(g, {}, undefined, { persona: 'farmer' }),
      persona: 'farmer',
      using: { provider },
    })
    // And `session new --topic` names the topic on the session it begins.
    let asked = await begin(g, undefined, {
      ...await openingFor(g, {}, undefined, {
        persona: 'oracle',
        topic: yaks,
      }),
      persona: 'oracle',
      topic: yaks,
      using: { provider },
    })
    // A session a helper starts, choosing nothing, wears its starter's
    // persona; one whose starter wears none works as the actor it names.
    await g.apply([
      { entity: { eid: 'starter' }, session: { persona: 'farmer' } },
      { entity: { eid: 'helper' }, spawned: { parent: 'starter' } },
      { entity: { eid: 'named' }, session: { actor: yaks } },
    ], { trusted: true })
    let from = async (via: string) =>
      (await g.get([
        await begin(g, undefined, {
          ...await openingFor(g, {}, undefined, { starter: via }),
          via,
          using: { provider },
        }),
      ]))[0]
    let helped = await from('helper')
    let entries = (s: string) =>
      g.read(`.entry.session=${s}&!ask&*&.order=entry.seq`)
    let rejected = await openingFor(g, {}, undefined, {
      persona: 'oracle',
      topic: 'nowhere',
    }).then(() => undefined, (error) => String(error.message))
    return {
      worn: await entries('worn'),
      commanded: await entries(command),
      plain: await entries('plain'),
      topical: await entries('topical'),
      opened: (await g.get([asked]))[0],
      session: (await g.get(['worn']))[0],
      helped,
      named: await from('named'),
      rejected,
      yaks,
    }
  } finally {
    await host.close()
  }
})()

let prompts = (entries: Comp[]) => entries.filter((e) => e.prompt)

test('a session wearing a persona opens with no copy of it, on no machine', () => {
  equal(prompts(opened.worn), [])
  equal(prompts(opened.topical), [])
  equal(opened.session.home, undefined)
})

test('a command line session wearing a persona opens with no copy of it either', () => {
  equal(opened.commanded, [])
})

test('a session wearing no persona is opened with nothing', () => {
  equal(prompts(opened.plain), [])
})

test('a session on a topic names the topic, and a topic that is not there is refused', () => {
  equal((opened.opened.session as Comp).topic, opened.yaks)
  equal(opened.rejected, 'no topic called nowhere')
})

test('a session its starter begins wears the persona its starter wears', () => {
  equal((opened.helped.session as Comp).persona, 'farmer')
})

test('a session whose starter wears no persona works as its starter does', () => {
  equal((opened.named.session as Comp).actor, opened.yaks)
  equal((opened.named.session as Comp).persona, undefined)
})
