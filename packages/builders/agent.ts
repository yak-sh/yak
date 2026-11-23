// An agent step: a builder whose tool is the person's own agent, such as
// Claude Code connected over MCP on their own subscription. Its call is
// answered later, as a model's is: the tool writes an `agent_step` task holding the
// rendered instructions, the agent finds it with `step_list`, does the work
// with its own tools and models, and answers with `step_answer`, which writes
// the call's `output{source, value}` like any tool's answer. The
// `builder_answer` effect turns it into the build's outputs and closes the
// step (./effects.ts), so the workflow carries on. Nothing here spends.

import { line } from '@yaks/query'
import type {
  Actor,
  Binding,
  Bundle,
  Comp,
  Eid,
  Graph,
  Tool,
} from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { derivedEid } from '@yaks/graph/identity'
import { signed } from '@yaks/graph/provenance'
import { CallError } from '@yaks/tools/errors'
import { toolEid } from '@yaks/tools/result'
import { valued } from '@yaks/tools/value'
import { toolsSaid } from '@yaks/vocab/tools'
import type { Vocab } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import { BUILD, ids } from './build.ts'
import { parse, type Wiring } from './answer.ts'
import { render } from './model.ts'

export let AGENT = 'builder_agent'
export let STEP = 'agent_step'
let definition = toolsSaid(doc).find((tool) => tool.name == AGENT)!
export let agentToolEid = (): Eid => toolEid(AGENT)

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let str = (v: unknown): string => v == null ? '' : String(v)
let title = (b: Bundle | undefined) => str(comp(b, 'doc')?.title)

/** The step a call asks for: one per call, so a replay finds it again. */
export let stepOf = (call: Eid): Eid => derivedEid(`builder_agent|${call}`)

// The steps still open, and the calls they answer.
let open = async (g: Graph) => {
  let steps = await g.read(line`.${STEP} !completed !cancelled&*`)
  let calls = await g.get(steps.map((s) => str(comp(s, STEP)?.call)))
  return steps.map((step, i) => ({ step, call: calls[i] }))
}

/** The open steps of `build` other than the one for `call`. */
let superseded = async (g: Graph, build: Eid, call: Eid) =>
  (await open(g)).filter((o) =>
    o.call?.entity.eid != call && comp(o.call, 'call')?.source == build
  ).map((o) => o.step)

/** The tool a builder names for a step the person's agent takes. */
export let agentTool = (): Tool => ({
  ...definition,
  run: async (call: Bundle, graph: Graph): Promise<Bundle[]> => {
    let args = comp(call, 'call')?.args as {
      binding: Binding
      template?: string
    }
    let build = str(comp(call, 'call')?.source)
    let [run] = await graph.get([build])
    let builder = str(comp(run, BUILD)?.builder)
    let [defined, subject] = await graph.get([
      builder,
      args.binding.entities[0] ?? '',
    ])
    let named = [title(defined) || 'Step', title(subject)].filter(Boolean)
    let template = args.template ?? ''
    let instructions = [
      template ? render(template, args.binding) : '',
      `Inputs: ${ids(args.binding).join(', ') || '(none)'}`,
    ].filter(Boolean).join('\n\n')
    return [
      {
        entity: { eid: stepOf(call.entity.eid) },
        task: {},
        doc: { title: named.join(': '), body: instructions },
        [STEP]: { call: call.entity.eid },
      },
      ...(await superseded(graph, build, call.entity.eid)).map((s) => ({
        entity: s.entity,
        cancelled: {},
      })),
    ]
  },
})

/** One step waiting for the agent, as `step_list` answers it. */
export type Waiting = {
  step: Eid
  title: string
  instructions: string
  builder: Eid
  binding: Binding
  failed?: string
}

/** The steps waiting for the person's agent: open, and still asked by their
 * build. One whose last answer was refused says why. */
export let waiting = async (graph: Graph): Promise<Waiting[]> => {
  let steps = await open(graph)
  let runs = await graph.get(
    steps.map((o) => str(comp(o.call, 'call')?.source)),
  )
  return steps.flatMap(({ step: s, call }, i) => {
    let b = comp(runs[i], BUILD)
    if (!call || !b || b.call != call.entity.eid || b.stale) return []
    let failed = str(comp(runs[i], 'failed')?.reason)
    return [{
      step: s.entity.eid,
      title: title(s),
      instructions: str(comp(s, 'doc')?.body),
      builder: str(b.builder),
      binding: (comp(call, 'call')?.args as { binding: Binding }).binding,
      ...failed ? { failed } : {},
    }]
  })
}

/** What `step_answer` asks: the step, and the outputs its agent made. */
export type Reply = { step: string; outputs: unknown[] }

/** Answer a step as its call's output. The contract is checked here, so a
 * mistake is told to the agent at once; what the store refuses on writing is
 * the build's `failed{reason}`, and `step_list` offers the step again. */
export let reply = async (
  graph: Graph,
  vocab: Vocab,
  ask: Reply,
  actor: Actor | null,
): Promise<Eid> => {
  let eid = (await graph.address([ask.step])).get(ask.step) ?? ask.step
  let [step] = await graph.get([eid])
  let call = str(comp(step, STEP)?.call)
  if (!call) throw new CallError('refused', `${ask.step} is no step`)
  if (step.completed || step.cancelled) {
    throw new CallError(
      'refused',
      `${ask.step} is already ${step.completed ? 'answered' : 'superseded'}`,
    )
  }
  let [asked] = await graph.get([call])
  let args = comp(asked, 'call')?.args as {
    binding: Binding
    wiring?: Wiring
  }
  let value = { outputs: ask.outputs }
  try {
    parse(value, ids(args.binding), vocab, (slot) => slot, args.wiring)
  } catch (err) {
    throw new CallError('refused', (err as Error).message)
  }
  await graph.apply(
    signed([{
      entity: { eid: crypto.randomUUID() },
      output: { source: call, value },
    }], actor),
    { trusted: true },
  )
  return eid
}

/** The `step_list` and `step_answer` tools' runs. */
export let stepRuns = (host: { vocab: Vocab }) => ({
  step_list: async (call: Bundle, graph: Graph): Promise<Bundle[]> => [
    valued(call, { steps: await waiting(graph) }),
  ],
  step_answer: async (call: Bundle, graph: Graph): Promise<Bundle[]> => {
    let step = await reply(graph, host.vocab, argsOf(call) as Reply, who(call))
    return [valued(call, { step, answered: true })]
  },
})
