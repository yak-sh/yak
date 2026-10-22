// A session any door writes as data (a browser's chat: the session, the
// persona it wears, its first message) opens with that persona's
// instructions, admitted by the runner before its first turn.
import { equal, ok, test, throws } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
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
  try {
    await g.apply([
      { entity: { eid: provider }, provider: { name: 'openai' } },
      {
        entity: { eid: 'oracle' },
        persona: {},
        doc: { title: 'Oracle', body: 'Tend the topic of yaks.' },
      },
      ...begun('worn', 'oracle'),
      ...begun('plain'),
    ], { trusted: true })
    for (let session of ['worn', 'worn', 'plain']) {
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
      plain: await prompts('plain'),
      session: (await g.get(['worn']))[0],
    }
  } finally {
    await host.close()
  }
})()

test('a session wearing a persona opens with its instructions once, on no machine', () => {
  equal(opened.worn.length, 1)
  ok(String((opened.worn[0].content as Comp).body).includes('Tend the topic'))
  equal(opened.session.home, undefined)
})

test('a session wearing no persona is opened with nothing', () => {
  equal(opened.plain.length, 0)
})
