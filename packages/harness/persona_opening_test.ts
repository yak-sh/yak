// A session any door writes as data (a browser's chat: the session, the
// persona it wears, the topic it is opened on, its first message) opens with
// that persona's instructions, the topic's tree after them, and the tools the
// persona offers, admitted by the runner before its first turn.
import { equal, ok, test, throws } from '@yaks/testing'
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
      // paid ask.
      await throws(() =>
        handlers.session_run(
          { entity: { eid: session + '-said' } } as never,
          g,
          {} as never,
          {} as never,
        ), 'Choose a model')
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
    let prompts = (s: string) =>
      g.read(`.entry.session=${s}&.prompt&*&.order=entry.seq`)
    return {
      worn: await prompts('worn'),
      tooled: await prompts('tooled'),
      commanded: await prompts(command),
      plain: await prompts('plain'),
      topical: await prompts('topical'),
      asked: await prompts(asked),
      session: (await g.get(['worn']))[0],
      opened: (await g.get([asked]))[0],
      yaks,
    }
  } finally {
    await host.close()
  }
})()

let offered = (prompt: Comp) => (prompt.sending as Comp | undefined)?.tools

test('a session wearing a persona opens with its instructions once, on no machine', () => {
  equal(opened.worn.length, 1)
  ok(String((opened.worn[0].content as Comp).body).includes('Tend the topic'))
  equal(opened.session.home, undefined)
})

test('a persona offering no tools leaves the runner its own', () => {
  equal(offered(opened.worn[0]), undefined)
})

test('a persona offers its sessions the tools it and the personas it contains contain', () => {
  equal(opened.tooled.length, 1)
  equal(offered(opened.tooled[0]), ['topic_find', 'search'])
})

test('a session begun wearing a persona is offered the same tools', () => {
  equal(opened.commanded.length, 1)
  equal(offered(opened.commanded[0]), ['topic_find', 'search'])
})

test('a session wearing no persona is opened with nothing', () => {
  equal(opened.plain.length, 0)
})

let said = (prompts: Comp[]) =>
  prompts.map((p) => String((p.content as Comp).body))

test('a session on a topic opens with its persona, then the topic compiled', () => {
  for (let prompts of [opened.topical, opened.asked]) {
    let [persona, topic] = said(prompts)
    ok(persona.includes('Tend the topic of yaks.'))
    ok(topic.includes('Yaks\n\nWhat belongs under yaks.'), topic)
    ok(topic.includes('A yak is a bovid.'))
  }
  equal((opened.opened.session as Comp).topic, opened.yaks)
})
