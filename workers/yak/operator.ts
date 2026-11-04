import { type Bundle, type Comp, identityEid, namedTool } from '@yaks/graph'
import { begin, lend, seed } from '@yaks/harness'
import { settle, statusOf, type Tool, transcript } from '@yaks/session'
import { listing } from '@yaks/mcp'
import { billed, type Model, type Price } from '@yaks/model'
import { modelInfo, workersAi } from '@yaks/workers-ai'
import { inputSchemaOf } from '@yaks/tools/schema'
import { CallError, invoke } from '@yaks/tools'
import { loadTools } from '@yaks/graph/tools'
import { taskDoc } from '@yaks/task/vocab'
import { runs as taskRuns } from '@yaks/task/tools'
import { worded } from '@yaks/tools'
import { directory, type Space } from './directory.ts'
import * as directoryPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { narrowed } from './grants.ts'
import { inReach } from './declared.ts'
import { reaching } from './agent.ts'
import { type Args, type Ctx, refuse } from './tool.ts'
import { bound, type Env } from './env.ts'
import type { Held } from './build.ts'
import { accounted } from './meter.ts'
import { caught } from './defects.ts'
import { instructions } from './guide.ts'
import { standing } from './standing.ts'
import type { operatorStore } from './operator-store.ts'

type Store = ReturnType<typeof operatorStore>
export type Options = {
  model?: Model
  name?: string
  price?: Price
  session?: string
  task?: string
  tools?: (ctx: Ctx) => Tool[]
}
let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

// Each space has its own Operator, working on that space alone. The one on a
// person's own space (`member.own`) is their PA: it reaches every space they
// sit in, as they would, so their role in each is what it may do there.
export let operatorContext = async (
  env: Env,
  held: Held,
  space: Space,
): Promise<Ctx> => {
  let open = () =>
    directory(bound(env.DIRECTORY, directoryPart.fetch, env), {
      copy: copyOf(env),
      time: env.CLOCK,
    })
  let pa = (await open().seats(held.person, 'owner'))
    .some((s) => s.own && s.space.eid == space.eid)
  let reopen = () =>
    pa ? open() : narrowed(open(), space.slug, space.eid, held.administrative)
  return {
    env,
    dir: reopen(),
    reopen,
    person: held.person,
    who: {
      person: held.person,
      via: 'session',
      ...pa ? {} : { space: space.slug, spaceEid: space.eid },
      actor: space.eid,
    },
  }
}

// What the Operator is told of the spaces it reaches beyond its own: none,
// except as a PA.
let beyond = async (ctx: Ctx, space: Space) => {
  let others = (await ctx.dir.seats(ctx.person))
    .filter((s) => s.space.eid != space.eid && !s.space.trashed)
  return others.length
    ? `\n\n${space.slug} is this person's own space, so you are their personal assistant and also reach their other spaces, with their role in each: ${
      others.map((s) => `${s.space.slug} (${s.role})`).join(', ')
    }. Name the space, or the app as space/app, to work in one of them.`
    : ''
}

let workbench = new Set([
  'graph_schema',
  'graph_query',
  'graph_show',
  'graph_apply',
  'app_list',
  'app_new',
  'app_files',
  'app_deploy',
  'app_versions',
  'app_rollback',
  'app_errors',
  'app_set',
  'commands',
  'command',
  'guide',
  'about',
  'domain_attach',
  'domain_status',
  'domain_detach',
  'sandbox_shell',
  'sandbox_wait',
  'sandbox_read',
  'sandbox_write',
  'sandbox_stop',
  'sandbox_ship',
  'task_update',
])

// Discovery is refreshed before every ask: a deploy may add words and tools.
export let operatorRoster = async (ctx: Ctx, work?: Store): Promise<Tool[]> => {
  ctx.dir = ctx.reopen!()
  let g = await reaching(ctx, await inReach(ctx))
  let privateTools = work
    ? loadTools([taskDoc], taskRuns()).filter((t) => t.name == 'task_update')
    : []
  return [...listing({ graph: g }), ...privateTools].map(namedTool)
    .filter((t) => workbench.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: inputSchemaOf(t),
      readOnly: t.readOnly,
      run: async (args, context) => {
        let call = context!.call
        let target = t.name == 'task_update' ? work!.g : g
        let fault: unknown
        let out = await invoke(
          {
            ...call,
            call: {
              ...comp(call, 'call'),
              args,
              actor: { by: ctx.who!.actor!, via: context!.session },
            },
            $actor: {
              by: ctx.who!.actor!,
              via: context!.session,
            },
          },
          t,
          target,
          {
            report: (e) => {
              fault = e
              caught(e, { request: 'operator tool', tool: t.name })
            },
          },
          (answer, state, keeps) =>
            !t.readOnly && !t.applied && state == 'done' && keeps !== false
              ? target.apply(answer)
              : answer,
        )
        let refusal = out.find((b) => b.refusal)
        if (refusal) {
          throw new CallError(
            String(comp(refusal, 'refusal')?.code),
            String(comp(refusal, 'content')?.body),
          )
        }
        if (fault) throw fault
        // Applied tools already wrote through their own store; generic writes
        // return patches and use the same graph application as the connector.
        return worded(out) || JSON.stringify(out)
      },
    }))
}

export let operatorModel = (env: Env): Model =>
  workersAi(env.AI!, { fetch: env.MODEL_FETCH, gateway: env.AI_GATEWAY })

export let readOperator = async (
  { g }: Store,
  task?: string,
  context = false,
) => {
  if (!task) {
    return { tasks: await g.read('.task ?doc .order=-created.at .limit=20') }
  }
  let [row] = await g.get([task])
  if (!row?.task) throw refuse('missing', `no operator task ${task}`)
  let comments = await g.read(`.comment.target=${task} ?doc .order=created.at`)
  let links = await g.read(`.contains .edge.from=${task}`)
  let sessions = await g.get(links.map((b) => String(comp(b, 'edge')!.to)))
  let entries =
    (await Promise.all(sessions.map((b) => transcript(g, b.entity.eid)))).flat()
  return {
    task: row,
    comments,
    sessions,
    entries: context
      ? entries
      : entries.map(({ sending: _sending, ...entry }) => entry),
  }
}

export let runOperator = async (
  store: Store,
  env: Env,
  held: Held,
  space: Space,
  args: Args,
  options: Options = {},
) => {
  let { g, fx, vocab } = store
  let text = typeof args.say == 'string' ? args.say.trim() : ''
  let task = typeof args.task == 'string'
    ? args.task
    : options.task ?? crypto.randomUUID()
  let [resuming] = options.session ? await g.get([options.session]) : []
  let [old] = await g.get([task])
  if (args.task && !old?.task) {
    throw refuse('missing', `no operator task ${task}`)
  }
  if (!old && !text) throw refuse('arguments', 'say what you want done')
  await g.apply([
    {
      entity: { eid: space.eid },
      doc: { title: `${space.slug}'s operator` },
      project: {},
      persona: {},
    },
    { entity: { eid: held.person }, person: {} },
    ...old && text && !resuming?.session
      ? [{ entity: { eid: task }, completed: null, cancelled: null }]
      : [],
    ...!old
      ? [{
        entity: { eid: task },
        task: {},
        doc: { title: text.split('\n')[0].slice(0, 160), body: text },
        filed: { project: space.eid },
        $actor: { by: held.person },
      }]
      : [],
  ], { trusted: true })
  if (old && text && !resuming?.session) {
    await g.apply([{
      entity: { eid: crypto.randomUUID() },
      comment: { target: task },
      doc: { body: text },
      $actor: { by: held.person },
    }])
  }
  try {
    let history = await readOperator(store, task)
    let request = JSON.stringify({
      task: history.task,
      comments: history.comments,
    })
    let ctx = await operatorContext(env, held, space)
    let name = options.name ?? env.OPERATOR_MODEL ?? env.BUILDER_MODEL_PAID ??
      '@cf/zai-org/glm-5.3'
    if (!options.model && !name.startsWith('@cf/')) {
      throw new Error(
        'The operator needs a priced Workers AI model in OPERATOR_MODEL',
      )
    }
    let provider = name.startsWith('@cf/') ? 'workers-ai' : 'openai'
    let price = options.price ??
      (name.startsWith('@cf/')
        ? (await modelInfo(name, env.MODEL_FETCH)).price
        : undefined)
    if (!options.model && !price) {
      throw new Error(`No catalogue price for operator model ${name}`)
    }
    let spent = 0
    let model = accounted(
      env,
      (dir) => dir.at(space.eid),
      options.model ?? operatorModel(env),
      () => Promise.resolve(price),
    )
    let paid: Model = Object.assign(async (req: Parameters<Model>[0]) => {
      let reply = await model(req)
      let cost = billed(reply, price)
      spent += cost?.dollars ?? 0
      return { ...reply, cost: cost?.dollars, costReported: cost?.reported }
    }, model)
    let rows = seed({ provider, model: name })
    if (price) {
      rows.push({ entity: { eid: identityEid('model', [name]) }, price })
    }
    await g.apply(rows, { trusted: true })
    let session = resuming?.session
      ? options.session!
      : await begin(g, request, {
        eid: options.session,
        persona: space.eid,
        by: held.person,
        project: space.eid,
        using: {
          provider: identityEid('provider', [provider]),
          model: identityEid('model', [name]),
        },
      })
    ctx.who!.instrument = session
    if (!resuming?.session) {
      await g.apply([{
        entity: { eid: crypto.randomUUID() },
        edge: { from: task, to: session },
        contains: {},
      }])
    }
    let runner = lend({
      h: { g, fx, vocab, me: space.eid },
      model: paid,
      name,
      provider,
      remote: async () => [
        ...await operatorRoster(ctx, store),
        ...options.tools?.(ctx) ?? [],
      ],
      instructions: `${instructions(env)}\n\n${await standing(ctx)
        .notes()}\n\nYou work for the owner of ${space.slug}. Carry out this task using the space's existing apps and rows. Read the app's schema and rows before changing data. Make the requested change, then explain what changed and the next step. Ask when required details are missing; never invent meeting dates, times or legal text. A request may be an idea or a design prepared by another agent. Your conversation and tools are recorded on its task. Use task_update with status done on this task only when the requested work is finished. Leave it open when asking a question, reporting a limit, or explaining unfinished work.${await beyond(
          ctx,
          space,
        )}`,
      report: (e, where) =>
        caught(e, { request: 'operator', ...where, space: space.slug }),
    })
    // This door waits for the native runner. Its budget is checked and charged
    // for every provider request; transcript length imposes no turn limit.
    await settle(g, session, { ...runner, asyncTools: false })
    let entries = await transcript(g, session)
    let state = statusOf(entries)
    let last = [...entries].reverse().find((b) =>
      b.content && (b.output || b.refusal || b.exception)
    )
    let answer = String(
      last && comp(last, 'content')?.body || 'The request has no answer yet.',
    )
    await g.apply([{
      entity: { eid: crypto.randomUUID() },
      comment: { target: task },
      doc: { body: answer },
      $actor: { by: space.eid, via: session },
    }])
    return {
      task,
      session,
      text: answer,
      status: state,
      cost: spent,
      model: name,
    }
  } catch (error) {
    await g.apply([{
      entity: { eid: crypto.randomUUID() },
      comment: { target: task },
      doc: { body: error instanceof Error ? error.message : String(error) },
      $actor: { by: space.eid },
    }])
    throw error
  }
}
