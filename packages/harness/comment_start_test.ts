// A person's comment on an open task nobody holds, committed through a
// composed box graph, owes one `session_start`, and the harness starts the
// session wearing the common persona of the task's lineage and asking what
// the task's project says its work runs on, `using{provider, model}` on the
// project; a project that names none gets the harness's default model.
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
  let opus = identityEid('model', ['opus'])
  let claude = identityEid('provider', ['claude'])
  try {
    await g.apply([
      { entity: { eid: model }, model: { name: 'gpt-6-astra' } },
      { entity: { eid: provider }, provider: { name: 'openai' } },
      { entity: { eid: HARNESS }, using: { provider, model } },
      { entity: { eid: opus }, model: { name: 'opus' } },
      { entity: { eid: claude }, provider: { name: 'claude' } },
      {
        entity: { eid: 'p' },
        project: {},
        doc: { title: 'Project' },
        using: { provider: claude, model: opus },
      },
      { entity: { eid: 'q' }, project: {}, doc: { title: 'Plain' } },
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
      {
        entity: { eid: 'chore' },
        task: {},
        doc: { title: 'Oil the hinge' },
        filed: { project: 'q' },
      },
    ], { trusted: true })
    let say = (eid: string, on: string) =>
      g.apply([{
        entity: { eid },
        comment: { target: on },
        doc: { body: 'the hinge squeaks' },
        $actor: { by: 'jeff', via: 'web' },
      }])
    // The session a comment started, and the `using` its first input carries.
    let start = async (comment: string) => {
      await handlers.session_start(
        { entity: { eid: comment } } as never,
        g,
        {} as never,
        {} as never,
      )
      let [session] = await g.read(`.session.source=${comment}&*`)
      let [input] = await g.read(
        `.entry.session=${session.entity.eid}&.using&*`,
      )
      return { session, using: input.using }
    }
    await say('word', 'job')
    let owed = await g.read('.effect.handler=session_start&*')
    let { session, using } = await start('word')
    await say('aside', 'chore')
    return {
      owed: owed.map((b) => (b.effect as Comp).target),
      session: session.session as Comp,
      native: !!session.native,
      filed: session.filed,
      using,
      plain: (await start('aside')).using,
      project: { provider: claude, model: opus },
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
  let { eid, session, holds, using: _, plain: __, project: ___, ...rest } =
    started
  equal(rest, {
    owed: ['word'],
    native: true,
    filed: { project: 'p' },
    default: started.plain,
    said: true,
  })
  equal([session.persona, session.source, session.operator], [
    'crew',
    'word',
    false,
  ])
  equal((holds as Comp).session, eid)
})

test("the session asks what the task's project runs its work on, and the default where the project names none", () => {
  equal(started.using, started.project)
  equal(started.plain, started.default)
})
