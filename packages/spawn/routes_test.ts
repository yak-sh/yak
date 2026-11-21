// `/session/spawn` as another host asks it: the brief filed as a task and an
// agent started on it, both written as whoever the host says is asking; and
// `/session/stop`, that run stopped, by the same caller alone.
import { line } from '@yaks/query'
import { equal, test } from '@yaks/testing'
import type { Actor, Bundle, Comp, Graph } from '@yaks/graph'
import { graph, identityEid } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { link } from '@yaks/edge'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { nameKeywords } from '@yaks/names'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { runs as taskRuns } from '@yaks/task/tools'
import { accountEid, modelDoc } from '@yaks/model'
import { personaDoc } from '@yaks/persona'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { fileDoc } from '@yaks/file/vocab'
import { machineDoc } from '@yaks/machine/vocab'
import { processDoc } from '@yaks/process'
import { runner } from '@yaks/tools'
import { provenanceDoc } from '@yaks/provenance'
import { runs } from './tools.ts'
import { spawnDoc } from './vocab.ts'
import { PATH, routes, STOP } from './routes.ts'

let vocab = loadVocab(
  [
    kernelDoc,
    idDoc,
    sessionDoc,
    toolsDoc,
    modelDoc,
    fileDoc,
    machineDoc,
    personaDoc,
    processDoc,
    docDoc,
    taskDoc,
    spawnDoc,
    edgeDoc,
    provenanceDoc,
  ],
  [kernelKeywords, idKeywords, nameKeywords, edgeKeywords],
)

let MODEL = identityEid('model', ['opus'])
let PERSONA = crypto.randomUUID(), STANDING = crypto.randomUUID()

// A host whose door says every request is `actor`, as a tunnel's says the
// persona through the session standing for its conversation; or says nobody.
let hosting = async (
  first: Actor | null,
  offered = true,
  cli = 'claude',
) => {
  let actor = first
  let PROVIDER = identityEid('provider', [cli])
  let g: Graph = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [ids(vocab), sessions()],
  })
  await g.apply([
    {
      entity: { eid: PROVIDER },
      provider: { name: cli, transport: 'process' },
    },
    {
      entity: { eid: MODEL },
      model: { name: 'opus', label: 'Claude Code Opus' },
    },
    { ...link(PROVIDER, 'serves', MODEL), serves: { name: 'opus' } },
    { entity: { eid: PERSONA }, persona: {}, doc: { title: 'An Operator' } },
    { entity: { eid: STANDING }, session: { door: 'tunnel' } },
    ...offered
      ? [{
        entity: { eid: accountEid('/u/.claude-teams') },
        account: { home: '/u/.claude-teams', provider: PROVIDER, offered },
      }]
      : [],
  ], { trusted: true })
  let tools = [
    ...loadTools(taskDoc, taskRuns()),
    ...loadTools(spawnDoc, runs({ graph: g })),
  ]
  let served = routes({
    graph: g,
    who: () => actor,
    runner: runner(g, { tools }),
    machine: 'workbench',
  }, { provider: PROVIDER })
  let at = (path: string) => (body: object) =>
    served.find((r) => r.path == path)!.handle(
      new Request(`http://machine${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  let as = (who: Actor) => actor = who
  return { g, ask: at(PATH), stop: at(STOP), as }
}

let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp

test('a brief becomes a task and a run on it, written as the tunnel’s caller', async () => {
  let { g, ask } = await hosting({ by: PERSONA, via: STANDING })
  let r = await ask({ title: 'Check the parser', brief: 'Fix the parser.' })
  let spawned = await r.json()
  let [task, session] = await g.get([spawned.task, spawned.session])
  let [first] = await g.read(
    line`.entry.session=${spawned.session}&.using&.fields=using,content.body`,
  )
  equal(r.status, 200)
  equal(comp(task, 'doc'), {
    title: 'Check the parser',
    body: 'Fix the parser.',
  })
  equal(comp(task, 'created').by, PERSONA)
  equal(comp(task, 'created').via, STANDING)
  equal(comp(task, 'claim').session, spawned.session)
  equal(comp(session, 'spawned').parent, STANDING)
  equal(comp(session, 'created').by, PERSONA)
  equal(comp(first, 'using').provider, identityEid('provider', ['claude']))
  equal(String(comp(first, 'content').body).includes('Fix the parser.'), true)
  equal(spawned.names.task.startsWith('T-'), true)
  equal(spawned.machine, 'workbench')
  equal(spawned.model, undefined)
})

test('a run asks for a model, and one its provider does not serve is refused', async () => {
  let { g, ask } = await hosting({ by: PERSONA, via: STANDING })
  let spawned = await (await ask({ brief: 'Go.', model: MODEL })).json()
  let [first] = await g.read(
    line`.entry.session=${spawned.session}&.using&.fields=using`,
  )
  let refused = await ask({ brief: 'Go.', model: 'nobody-serves-this' })
  equal(comp(first, 'using').model, MODEL)
  equal(spawned.model, 'Claude Code Opus')
  equal(refused.status, 422)
})

test('nobody, and no brief, start nothing', async () => {
  let nobody = await (await hosting(null)).ask({ brief: 'Go.' })
  let { g, ask } = await hosting({ by: PERSONA, via: STANDING })
  let empty = await ask({ brief: '  ' })
  equal([nobody.status, empty.status], [403, 400])
  equal(await g.read(line`.task&.fields=entity.eid`), [])
})

test('a run is stopped by the conversation that asked for it, and no other', async () => {
  let { g, ask, stop, as } = await hosting({ by: PERSONA, via: STANDING })
  let { session } = await (await ask({ brief: 'Go.' })).json()
  as({ by: PERSONA, via: crypto.randomUUID() })
  let stranger = await stop({ session })
  let untouched = comp((await g.get([session]))[0], 'stop')
  as({ by: PERSONA, via: STANDING })
  let stopped = await stop({ session })
  let [row] = await g.get([session])
  equal([stranger.status, untouched], [404, {}])
  equal([stopped.status, await stopped.json()], [200, { session }])
  equal(row.stop != null, true)
})

test('a spawn with no account offered says so and starts nothing', async () => {
  let { g, ask } = await hosting({ by: PERSONA, via: STANDING }, false)
  let r = await ask({ brief: 'Go.' })
  equal(r.status, 422)
  equal(
    (await r.json()).error.message.includes('no claude account is offered'),
    true,
  )
  equal(await g.read(line`.session.door=spawn&.fields=entity.eid`), [])
})

test('a codex spawn signs in with its one login when none is offered', async () => {
  let { g, ask } = await hosting({ by: PERSONA, via: STANDING }, false, 'codex')
  let r = await ask({ brief: 'Go.' })
  let { session } = await r.json()
  let [first] = await g.read(
    line`.entry.session=${session}&.using&.fields=using`,
  )
  equal(r.status, 200)
  equal(comp(first, 'using').provider, identityEid('provider', ['codex']))
})
