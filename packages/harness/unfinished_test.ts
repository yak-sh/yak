import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { effectDoc, effects } from '@yaks/effects'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { modelDoc } from '@yaks/model'
import { processDoc } from '@yaks/process'
import { projectDoc } from '@yaks/project/vocab'
import { ram } from '@yaks/ram'
import { answer, currentStatus, running } from '@yaks/session'
import { sessionDoc, sessions, statusComputed } from '@yaks/session'
import { equal, match, test } from '@yaks/testing'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '../doc/vocab.ts'
import { healDoc } from '../heal/vocab.ts'
import { provenanceDoc } from '../provenance/vocab.ts'
import { taskDoc } from '../task/comp.ts'
import { recoverSettled } from './unfinished.ts'

let session = 'worker'
let task = 'work'
let latest = 'Resume from the policy trace. The policy write still needs a fix.'
let provider = identityEid('provider', ['scripted'])
let model = identityEid('model', ['scripted'])
let vocab = loadVocab([
  kernelDoc,
  docDoc,
  taskDoc,
  edgeDoc,
  sessionDoc,
  toolsDoc,
  modelDoc,
  processDoc,
  projectDoc,
  effectDoc,
  healDoc,
  provenanceDoc,
], [kernelKeywords, edgeKeywords])

let fixture = async (mode: string) => {
  let fx = effects(vocab, { owner: 'runner' })
  let g = graph({
    vocab,
    storage: ram(vocab, { computed: statusComputed }),
    plugins: [kernel(), sessions(), fx],
  })
  let reports: string[] = []
  let asks = 0
  let writes: Bundle[] = [
    { entity: { eid: 'runner' }, process: {} },
    { entity: { eid: provider }, provider: { name: 'scripted' } },
    { entity: { eid: model }, model: { name: 'scripted' } },
    {
      entity: { eid: session },
      session: {
        id: session,
        ...mode.startsWith('comment') ? { source: 'question' } : {},
      },
      ...mode == 'outside' ? {} : { native: {} },
    },
    {
      entity: { eid: task },
      task: {},
      doc: { title: 'Policy trace' },
      claim: { session },
      ...mode == 'blocked' ? { blocked: { on: 'external approval' } } : {},
    },
    {
      entity: { eid: 'go' },
      entry: { session },
      content: { body: 'Fix the policy write' },
      using: { provider, model },
    },
  ]
  if (mode == 'comment' || mode == 'comment-unanswered') {
    writes.push({
      entity: { eid: 'question' },
      comment: { target: task },
      doc: { body: 'What happened?' },
    })
  }
  if (mode == 'dependency') {
    writes.push({
      entity: { eid: 'dep' },
      task: {},
      blocked: { on: 'external approval' },
    }, link(task, 'requires', 'dep'))
  }
  if (mode == 'delegated') {
    writes.push({
      entity: { eid: 'child' },
      session: { id: 'child' },
      native: {},
      spawned: { parent: session },
      dispatch: { state: 'active' },
    })
  }
  if (mode == 'heal' || mode == 'muted-heal') {
    writes.push(
      { entity: { eid: 'bug' }, doc: { title: 'Fixture bug' } },
      { entity: { eid: session }, fixer: { bug: 'bug' } },
      { entity: { eid: task }, filed: { project: 'project' } },
      {
        entity: { eid: 'project' },
        project: {},
        ...mode == 'muted-heal' ? { nofix: {} } : {},
      },
      link(task, 'about', 'bug'),
    )
  }
  await g.apply(writes, { trusted: true })
  let runner = {
    holder: 'runner',
    tools: [],
    recoverSettled: recoverSettled(
      g,
      (error) => void reports.push(String(error)),
    ),
    model: async () => {
      asks++
      if (asks == 1 && mode == 'comment') {
        await g.apply([{
          entity: { eid: 'reply' },
          comment: { target: task },
          doc: { body: 'The policy trace is on the task.' },
          $actor: { via: session },
        }], { trusted: true })
      }
      if (asks == 2 && (mode == 'complete' || mode == 'release')) {
        await g.apply(
          mode == 'complete'
            ? [{ entity: { eid: task }, completed: {} }]
            : [{ entity: { eid: task }, claim: null }, {
              entity: { eid: 'handoff' },
              comment: { target: task },
              doc: { body: latest },
            }],
          { trusted: true },
        )
      }
      return {
        id: `reply-${asks}`,
        model: 'scripted',
        items: [{ kind: 'assistant' as const, text: latest }],
      }
    },
  }
  fx.handle(running(g, runner))
  return {
    run: async () => {
      await answer(g, session, runner)
      await fx.work(g)
      await fx.idle()
      equal(await g.read('.effect.error'), [])
      let [work] = await g.get([task])
      let comments = await g.read(
        '.comment.target=work&.entity.eid!=question&.fields=doc.body',
      )
      equal(await currentStatus(g, session), 'settled')
      return { work, comments, reports, asks }
    },
  }
}

for (
  let mode of [
    'complete',
    'release',
    'unfinished',
    'comment-unanswered',
    'muted-heal',
  ]
) {
  let f = await fixture(mode)
  test(`native work can ${mode} after one recovery turn`, async () => {
    let { work, comments, reports, asks } = await f.run()
    equal(asks, 2)
    equal(work.claim, undefined)
    equal(!!work.completed, mode == 'complete')
    equal(reports.length, ['complete', 'release'].includes(mode) ? 0 : 1)
    if (mode != 'complete') {
      equal(comments.length, 1)
      match(
        String((comments[0].doc as Comp).body),
        /policy write still needs a fix/,
      )
    }
  })
}

for (
  let mode of [
    'blocked',
    'dependency',
    'outside',
    'comment',
    'delegated',
    'heal',
  ]
) {
  let f = await fixture(mode)
  test(`a resting ${mode} session keeps its claim without recovery`, async () => {
    let { work, reports, asks } = await f.run()
    equal(asks, 1)
    equal((work.claim as Comp).session, session)
    equal(reports, [])
  })
}
