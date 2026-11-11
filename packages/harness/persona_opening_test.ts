// A session any door writes as data (a browser's chat: the session, the
// persona it wears, the topic it is opened on, its first message) is offered
// the tools its persona offers, admitted by the runner before its first turn.
// The persona's text and the topic's tree are no part of what it opens with:
// each ask is told them afresh (./wear_test.ts).
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { toolEid } from '@yaks/tools/result'
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
  let tool = (name: string) => ({
    entity: { eid: toolEid(name) },
    tool: { name },
  })
  try {
    await g.apply([
      { entity: { eid: provider }, provider: { name: 'openai' } },
      persona('oracle', 'Tend the topic of yaks.'),
      persona('farmer', 'Tend the topic of barns.'),
      persona('base', 'Every farmer hears this.'),
      tool('topic_find'),
      tool('search'),
      link('farmer', 'contains', toolEid('topic_find')),
      link('farmer', 'contains', 'base'),
      link('base', 'contains', toolEid('search')),
      {
        entity: { eid: yaks },
        topic: { name: 'yaks' },
        doc: { title: 'Yaks', body: 'What belongs under yaks.' },
        content: { body: 'A yak is a bovid.' },
      },
      ...begun('worn', 'oracle'),
      ...begun('tooled', 'farmer'),
      ...begun('plain'),
      ...begun('topical', 'oracle', yaks),
    ], { trusted: true })
    for (let session of ['worn', 'worn', 'tooled', 'plain', 'topical']) {
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
    // Begun with no message, a session has nothing to carry its tools until
    // its first line arrives, which the runner then admits them on.
    await g.apply([{
      entity: { eid: 'later' },
      entry: { session: command },
      using: { provider },
      content: { body: 'What do you look after?' },
    }], { trusted: true })
    await handlers.session_run(
      { entity: { eid: 'later' } } as never,
      g,
      {} as never,
      {} as never,
    )
    let said = await begin(g, 'What do you look after?', {
      ...await openingFor(g, {}, undefined, { persona: 'farmer' }),
      using: { provider },
    })
    let entries = (s: string) =>
      g.read(`.entry.session=${s}&!ask&*&.order=entry.seq`)
    let rejected = await openingFor(g, {}, undefined, {
      persona: 'oracle',
      topic: 'nowhere',
    }).then(() => undefined, (error) => String(error.message))
    return {
      worn: await entries('worn'),
      tooled: await entries('tooled'),
      commanded: await entries(command),
      said: await entries(said),
      plain: await entries('plain'),
      topical: await entries('topical'),
      opened: (await g.get([asked]))[0],
      session: (await g.get(['worn']))[0],
      helped,
      helpedOpening: await openingFor(g, {}, undefined, { starter: 'helper' }),
      named: await from('named'),
      rejected,
      yaks,
    }
  } finally {
    await host.close()
  }
})()

let offered = (entry: Comp) => (entry.sending as Comp | undefined)?.tools
let prompts = (entries: Comp[]) => entries.filter((e) => e.prompt)

test('a session wearing a persona opens with no copy of it, on no machine', () => {
  equal(prompts(opened.worn), [])
  equal(prompts(opened.topical), [])
  equal(opened.session.home, undefined)
})

test('a persona offering no tools leaves the runner its own', () => {
  equal(offered(opened.worn[0]), undefined)
})

test('a persona offers its sessions the tools it and the personas it contains contain', () => {
  equal(offered(opened.tooled[0]), ['topic_find', 'search'])
})

test('a session begun wearing a persona is offered the same tools on its first line', () => {
  equal(offered(opened.said[0]), ['topic_find', 'search'])
  equal(offered(opened.commanded[0]), ['topic_find', 'search'])
})

test('a session wearing no persona is opened with nothing', () => {
  equal(prompts(opened.plain), [])
  equal(offered(opened.plain[0]), undefined)
})

test('a session on a topic names the topic, and a topic that is not there is refused', () => {
  equal((opened.opened.session as Comp).topic, opened.yaks)
  equal(opened.rejected, 'no topic called nowhere')
})

test('a session its starter begins wears the persona its starter wears', () => {
  equal((opened.helped.session as Comp).persona, 'farmer')
  equal(opened.helpedOpening.tools, ['topic_find', 'search'])
})

test('a session whose starter wears no persona works as its starter does', () => {
  equal((opened.named.session as Comp).actor, opened.yaks)
  equal((opened.named.session as Comp).persona, undefined)
})
