// A person's comment on an open task nobody holds, committed through a
// composed box graph, owes one `session_start`, and the harness starts the
// session as `session_new --work` would: wearing the common persona of the
// task's lineage and asking the default model.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { HARNESS } from './default.ts'
import { effects } from './effects.ts'
import { at } from './testing.ts'

let started = await (async () => {
  let config = at()
  let host = await compose(
    { ...config, plugins: [...config.plugins!, '@yaks/mail'] },
    ['graph'],
  )
  let g = host.graph
  let handlers = effects(host)
  let model = identityEid('model', ['gpt-6-astra'])
  let provider = identityEid('provider', ['openai'])
  try {
    await g.apply([
      { entity: { eid: model }, model: { name: 'gpt-6-astra' } },
      { entity: { eid: provider }, provider: { name: 'openai' } },
      { entity: { eid: HARNESS }, using: { provider, model } },
      { entity: { eid: 'p' }, project: {}, doc: { title: 'Project' } },
      {
        entity: { eid: 'crew' },
        persona: { home: 'p' },
        doc: { title: 'Crew', body: 'Work in your own checkout.' },
      },
      link('p', 'contains', 'crew'),
      { entity: { eid: 'jeff' }, person: {}, doc: { title: 'Jeff' } },
      { entity: { eid: 'web' }, process: {} },
      {
        entity: { eid: 'job' },
        task: {},
        doc: { title: 'Fix the door' },
        filed: { project: 'p' },
      },
    ], { trusted: true })
    await g.apply([{
      entity: { eid: 'word' },
      comment: { target: 'job' },
      doc: { body: 'the hinge squeaks' },
      $actor: { by: 'jeff', via: 'web' },
    }])
    let owed = await g.read('.effect.handler=session_start&*')
    await handlers.session_start(
      { entity: { eid: 'word' } } as never,
      g,
      {} as never,
      {} as never,
    )
    let [session] = await g.read('.session.source=word&*')
    let [input] = await g.read(
      `.entry.session=${session.entity.eid}&.using&*`,
    )
    return {
      owed: owed.map((b) => (b.effect as Comp).target),
      session: session.session as Comp,
      native: !!session.native,
      filed: session.filed,
      using: input.using,
      default: (await g.get([HARNESS]))[0].using,
      holds: (await g.get(['job']))[0].claim,
      said: !!(await g.get(['word']))[0].notified,
      eid: session.entity.eid,
    }
  } finally {
    await host.close()
  }
})()

test('a comment through the box graph owes one start, and the harness opens the session on the task', () => {
  let { eid, session, holds, using, ...rest } = started
  equal(rest, {
    owed: ['word'],
    native: true,
    filed: { project: 'p' },
    default: using,
    said: true,
  })
  equal([session.persona, session.source, session.operator], [
    'crew',
    'word',
    false,
  ])
  equal((holds as Comp).session, eid)
})
