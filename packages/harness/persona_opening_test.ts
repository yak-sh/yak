// A session any door writes as data (a browser's chat: the session, the
// persona it wears, its first message) opens with that persona's
// instructions, and the tools it offers, admitted by the runner before its
// first turn.
import { equal, ok, test, throws } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { toolEid } from '@yaks/tools/result'
import { effects } from './effects.ts'
import { at } from './testing.ts'

let opened = await (async () => {
  let host = await compose(at(), ['graph'])
  let g = host.graph
  let handlers = effects(host)
  let provider = identityEid('provider', ['openai'])
  let begun = (session: string, persona?: string) => [
    { entity: { eid: session }, session: { operator: true, persona } },
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
      ...begun('worn', 'oracle'),
      ...begun('tooled', 'farmer'),
      ...begun('plain'),
    ], { trusted: true })
    for (let session of ['worn', 'worn', 'tooled', 'plain']) {
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
    let prompts = (s: string) => g.read(`.entry.session=${s}&.prompt&*`)
    return {
      worn: await prompts('worn'),
      tooled: await prompts('tooled'),
      plain: await prompts('plain'),
      session: (await g.get(['worn']))[0],
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

test('a session wearing no persona is opened with nothing', () => {
  equal(opened.plain.length, 0)
})
