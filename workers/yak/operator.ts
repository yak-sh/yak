import { type Bundle, type Comp, identityEid, namedTool } from '@yaks/graph'
import { begin, lend, seed } from '@yaks/harness'
import {
  kindOf,
  ordered,
  running,
  sessionTools,
  statusOf,
  textOf,
  type Tool,
  transcript,
} from '@yaks/session'
import { derivedEid } from '@yaks/graph/identity'
import { LIMIT } from '@yaks/session/status'
import { listing } from '@yaks/mcp'
import { billed, type Item, type Model, type Price } from '@yaks/model'
import { workersAi } from '@yaks/workers-ai'
import { claude, providerOf, readsOf } from './claude.ts'
import { inputSchemaOf } from '@yaks/tools/schema'
import { CallError, invoke } from '@yaks/tools'
import { loadTools } from '@yaks/graph/tools'
import { taskDoc } from '@yaks/task/vocab'
import { runs as taskRuns } from '@yaks/task/tools'
import { worded } from '@yaks/tools'
import { directory, directoryOf, type Reach, type Space } from './directory.ts'
import * as directoryPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { narrowed } from './grants.ts'
import { reachOf } from './operator-reach.ts'
import { inReach } from './declared.ts'
import { reaching } from './agent.ts'
import { ledger } from './ledger.ts'
import { type Args, type Ctx, refuse } from './tool.ts'
import { bound, type Env } from './env.ts'
import type { Held } from './build-door.ts'
import { accounted } from './meter.ts'
import { caught, defect } from './defects.ts'
import { instructions } from './guide.ts'
import { standing } from './standing.ts'
import { drain, type operatorStore } from './operator-store.ts'
import { asIs, type File, SHOWN } from './operator-channels.ts'

type Store = ReturnType<typeof operatorStore>
export type Options = {
  model?: Model
  name?: string
  price?: Price
  tools?: (ctx: Ctx, files: File[]) => Tool[]
  // Told each time a session moved (a step landed, words were given), so a
  // page watching it hears at once (the Builder object's socket).
  tell?: (session: string) => void
  // Told each piece of a reply as the model writes it.
  typing?: (session: string, text: string) => void
}
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// Each space has its own Operator, working on that space and the spaces that
// let it in (operator-reach.ts), the PA's among them.
export let operatorContext = async (
  env: Env,
  held: Pick<Held, 'person' | 'administrative'>,
  space: Space,
): Promise<Ctx & { pa: boolean; beyond: Reach[] }> => {
  let open = () =>
    directory(bound(env.DIRECTORY, directoryPart.fetch, env), {
      copy: copyOf(env),
      time: env.CLOCK,
    })
  let { pa, beyond } = await reachOf(open(), space, held.person)
  let reopen = () =>
    narrowed(open(), space.slug, space.eid, held.administrative, beyond)
  return {
    env,
    dir: reopen(),
    reopen,
    person: held.person,
    pa,
    beyond,
    who: {
      person: held.person,
      via: 'session',
      ...beyond.length ? {} : { space: space.slug, spaceEid: space.eid },
      actor: space.eid,
    },
  }
}

// What the Operator is told of the spaces it reaches beyond its own.
let told = (
  ctx: Awaited<ReturnType<typeof operatorContext>>,
  space: Space,
) =>
  ctx.beyond.length
    ? `\n\n${
      ctx.pa
        ? `${space.slug} is this person's own space, so you are their personal assistant and also reach their other spaces`
        : `You also reach the spaces that let ${space.slug}'s Operator in`
    }, with the role you have in each: ${
      ctx.beyond.map((r) => `${r.space.slug} (${r.role})`).join(', ')
    }. Name the space, or the app as space/app, to work in one of them.`
    : ''

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
  // A tool's answer in words is the call's own, as at the connector's door:
  // only what it wrote for an app goes on to the app (ledger.ts).
  let landing = ledger(g)
  let privateTools = work
    ? loadTools([taskDoc], taskRuns()).filter((t) => t.name == 'task_update')
    : []
  return [...listing({ graph: g }), ...privateTools].map(namedTool)
    .filter((t) => workbench.has(t.name))
    .map((t) => ({
      name: t.name,
      ...t.title ? { title: t.title } : {},
      ...t.titles ? { titles: t.titles } : {},
      description: t.description,
      parameters: inputSchemaOf(t),
      readOnly: t.readOnly,
      run: async (args, context) => {
        let call = context!.call
        let [host, target] = t.name == 'task_update'
          ? [work!.g, work!.g]
          : [g, landing]
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
            host,
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

// What the Operator does when yaks.app, not the app, is at fault: it tells
// the platform's tracker (M-37965), where its people fix it, and changes
// nothing in the app to get around it.
let platformBug = (space: Space): Tool => ({
  name: 'platform_bug',
  title: 'Report a yaks.app fault',
  description:
    "Report that yaks.app itself is at fault, not the app's own files: a tool that answered wrongly, a refusal the guide says should pass, a deploy that lost what was sent. Say what you did, what yaks.app answered, and why the app is not the cause. It reaches the people who run yaks.app; leave the app as it is.",
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What is wrong in yaks.app.' },
      app: { type: 'string', description: 'The app it happened in.' },
    },
    required: ['text'],
  },
  run: (args) => {
    let text = String(args.text ?? '').trim()
    if (!text) throw refuse('arguments', 'say what is wrong in yaks.app')
    defect(Error(text), {
      request: 'operator found a platform fault',
      space: space.slug,
      ...typeof args.app == 'string' ? { app: args.app } : {},
    })
    return Promise.resolve('Reported to the people who run yaks.app.')
  },
})

// The Operator's own model, by default and with the key: Sonnet, which hands
// coding and tricky work to Opus. Without the key it stays on GLM.
let SONNET = 'claude-sonnet-5-5'
let OPUS = 'claude-opus-5-5'
let GLM = '@cf/zai-org/glm-5.3'

/** What serves the Operator's models: Workers AI through the binding, or
 * Anthropic with the platform's key. */
export let operatorModel = (env: Env, provider: string): Model =>
  provider == 'workers-ai'
    ? workersAi(env.AI!, { fetch: env.MODEL_FETCH, gateway: env.AI_GATEWAY })
    : provider == 'anthropic'
    ? claude(env)
    : Object.assign(
      () =>
        Promise.reject(
          new Error(
            'The operator needs a Workers AI or Anthropic model in OPERATOR_MODEL',
          ),
        ),
      { info: () => Promise.resolve(undefined) },
    )

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

// What an Operator session works with, kept on it (`operator_session`) so
// every step, in whichever wake of the object, reads it again: the space, and
// the person whose reach it has.
type Working = {
  space: string
  person: string
  administrative?: boolean
  files?: File[]
}
let workingOf = async ({ g }: Store, session: string) => {
  let [row] = await g.get([session])
  return comp(row, 'operator_session') as Working | undefined
}
let working = async (env: Env, store: Store, session: string) => {
  let o = await workingOf(store, session)
  if (!o) throw new Error(`Operator session ${session} names no space`)
  let space = await directoryOf(env.STORE).at(o.space)
  if (!space || space.trashed) throw refuse('missing', 'That space is gone.')
  let ctx = await operatorContext(env, o, space)
  ctx.who!.instrument = session
  return { space, ctx, files: o.files ?? [] }
}

let ENDED = ['settled', 'failed', 'stopped']

// What a model's refusal tells the person, by its code (@yaks/model
// `ModelError`); any other is a refused request. A ceiling (@yaks/session
// `LIMIT`) is said in its own sentence.
let REFUSED: Record<string, string> = {
  refusal: 'the model declined to do this',
  busy: 'the model is too busy to answer right now',
}
let couldnt = (why: string) => `I couldn't finish this: ${why}.`
let TOLD = ' The people who run yaks.app have been told.'

/**
 * What ended a session's work: its newest reply, else what kept it from one,
 * in plain words. `fault` is what went wrong, for the tracker: a refusal, a
 * failure, or an end with no reply. A person's stop is no fault, nor a
 * ceiling met (a spent budget says so in its own words), and a step that threw
 * was reported where it threw (@yaks/session `report`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { replyOf } from './operator.ts'
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...b,
 * })
 * let said = line(2, { output: { source: 'a' }, content: { body: 'Done.' } })
 * equal(replyOf([said]), { text: 'Done.' })
 * equal(replyOf([said, line(3, {
 *   output: { source: 'a' }, refusal: { code: 'request' },
 *   content: { body: '400 tools.26: input_schema does not support oneOf' },
 * })]), {
 *   text: "I couldn't finish this: the model refused the request." +
 *     ' The people who run yaks.app have been told.',
 *   fault: 'request: 400 tools.26: input_schema does not support oneOf',
 * })
 * equal(replyOf([line(3, {
 *   output: { source: 'a' }, refusal: { code: 'limit' },
 *   content: { body: "clerk's budget of $5 for models and voice is spent" },
 * })]), { text: "clerk's budget of $5 for models and voice is spent" })
 * equal(replyOf([]).fault, 'ended without an answer')
 * ```
 */
export let replyOf = (
  entries: Bundle[],
): { text: string; fault?: string } => {
  let end = ordered(entries).findLast((b) =>
    b.content && (b.output || b.refusal || b.exception) || b.failed ||
    kindOf(b) == 'stop'
  )
  let said = end ? textOf(end) : ''
  let kind = end && kindOf(end)
  if (kind == 'stop') return { text: said }
  if (kind == 'refusal' && comp(end, 'refusal')?.code == LIMIT) {
    return { text: said }
  }
  if (kind == 'output' && !end!.notice && said) return { text: said }
  let broke = couldnt('something in yaks.app failed while working on it')
  if (kind == 'exception') return { text: broke + TOLD }
  let code = String(comp(end, 'refusal')?.code)
  let fault = kind == 'refusal'
    ? `${code}: ${said}`
    : String(comp(end, 'failed')?.reason ?? '') || said ||
      'ended without an answer'
  let why = kind == 'refusal'
    ? couldnt(REFUSED[code] ?? 'the model refused the request')
    : end
    ? broke
    : 'This ended without an answer.'
  return { text: why + TOLD, fault }
}

// The entries since the newest words given: the turn being answered.
let turnOf = (entries: Bundle[]) =>
  entries.slice(
    Math.max(0, entries.findLastIndex((b) => kindOf(b) == 'input')),
  )

/**
 * The space's Operator: @yaks/harness's runner registered on the store's
 * pool, so every step of every Operator session is a durable effect
 * (@yaks/session `running`). Words given to it land in their task's session
 * even while it works ({@link Operator.ask}); its answer is written when the
 * session ends.
 */
export let operating = (
  store: Store,
  env: Env,
  options: Options = {},
): Operator => {
  let { g, fx, vocab } = store
  let name = options.name ?? env.OPERATOR_MODEL ??
    (env.ANTHROPIC_API_KEY ? SONNET : env.BUILDER_MODEL_PAID ?? GLM)
  let provider = providerOf(name)
  // Coding and tricky work go to a stronger model of the same provider, in a
  // child session (`spawn`) whose answer comes back to the one that asked.
  let delegate = provider == 'anthropic'
    ? env.OPERATOR_DELEGATE ?? OPUS
    : undefined
  let using = {
    provider: identityEid('provider', [provider]),
    model: identityEid('model', [name]),
  }
  let base = options.model ?? operatorModel(env, provider)
  let reads = readsOf(provider)
  // The files the model reads as they are, shown beside the words they came
  // with: the newest first, until SHOWN bytes are in the request; one past
  // that is named instead, and its words still say what it held.
  let shown = async (window: Bundle[]) => {
    let out = new Map<string, Item[]>()
    let room = SHOWN
    for (let entry of [...window].reverse()) {
      let files = (comp(entry, 'operator_files')?.files ?? []) as File[]
      let items: Item[] = []
      for (let file of files.filter((f) => asIs(reads, f))) {
        if (file.size! > room) {
          items.push({
            kind: 'user',
            text:
              `${file.name} was attached earlier, and is not shown again beside the newer files.`,
          })
          continue
        }
        let kept = await env.BLOBS.get(file.key)
        if (!kept) {
          throw new Error('Operator attachment is missing: ' + file.name)
        }
        room -= file.size!
        items.push({
          kind: file.mime == 'application/pdf' ? 'document' : 'image',
          bytes: new Uint8Array(await kept.arrayBuffer()),
          mediaType: file.mime,
          label: 'Attached: ' + file.name,
        })
      }
      if (items.length) out.set(entry.entity.eid, items)
    }
    return out
  }
  // A model's price, from what its provider lists, asked once per name.
  let prices = new Map<string, Promise<Price | undefined>>()
  let priced = (model: string) => {
    if (options.price) return Promise.resolve(options.price)
    let held = prices.get(model) ??
      Promise.resolve(base.info?.(model)).then((info) => info?.price)
    prices.set(model, held)
    held.catch(() => prices.delete(model))
    return held
  }
  // Each ask is charged to the space of the session asking, at the price of
  // the model it asks.
  let model: Model = Object.assign(async (req: Parameters<Model>[0]) => {
    let price = await priced(req.model)
    if (!options.model && !price) {
      throw new Error(`No catalogue price for operator model ${req.model}`)
    }
    let [ask] = req.call ? await g.get([req.call]) : []
    let session = comp(ask, 'entry')?.session
    let space = session
      ? (await workingOf(store, String(session)))?.space
      : null
    let heard = req.onText
    let reply = await accounted(
      env,
      (dir) => space ? dir.at(space) : Promise.resolve(null),
      base,
      () => Promise.resolve(price),
    )({
      ...req,
      ...heard
        ? {
          onText: (delta) => {
            heard(delta)
            if (session) options.typing?.(String(session), delta.text)
          },
        }
        : {},
    })
    let cost = billed(reply, price)
    return { ...reply, cost: cost?.dollars, costReported: cost?.reported }
  }, base)
  let seeded: Promise<void> | undefined
  let seeding = () =>
    seeded ??= (async () => {
      let rows: Bundle[] = []
      for (let m of delegate ? [name, delegate] : [name]) {
        let price = await priced(m)
        rows.push(...seed({ provider, model: m }))
        if (price) {
          rows.push({
            entity: { eid: identityEid('model', [m]) },
            price,
          })
        }
      }
      await g.apply(rows, { trusted: true })
    })()

  // The session's answer, once it ends: its newest reply as a comment on its
  // task, and as the answer of each request it was given that has none yet,
  // which its channel then delivers (operator_deliver).
  let answered = async (session: string) => {
    let entries = await transcript(g, session)
    let reply = replyOf(turnOf(entries))
    // One answer for each time it was given words: the turn ended again
    // (stopped, then a step in flight finishing) says it anew.
    let mark = entries.findLast((b) => kindOf(b) == 'input')
    let [link] = await g.read(`.contains .edge.to=${session}`)
    let task = String(comp(link, 'edge')?.from ?? '')
    let space = (await workingOf(store, session))?.space
    let answer = task && mark
      ? derivedEid('operator-answer|' + mark.entity.eid)
      : undefined
    // A conversation that could not finish reaches the tracker once, when
    // its answer is first written (M-37965).
    let { text } = reply
    if (reply.fault && !(answer && (await g.get([answer]))[0])) {
      let slug = space ? (await directoryOf(env.STORE).at(space))?.slug : null
      defect(Error(`Operator could not finish: ${reply.fault}`), {
        request: 'operator conversation',
        session,
        space: slug,
      })
    }
    let waiting = (await g.read(`.operator_request.session=${session}`))
      .filter((b) => !b.operator_answer)
    await g.apply([
      ...answer
        ? [{
          entity: { eid: answer },
          comment: { target: task },
          doc: { body: text },
          $actor: { by: space ?? task, via: session },
        }]
        : [],
      ...waiting.map((b) => ({
        entity: b.entity,
        operator_answer: { text, ...task ? { task } : {} },
      })),
    ], { trusted: true })
  }

  fx.handle(running(
    g,
    lend({
      h: { g, fx, vocab, me: identityEid('operator', ['runner']) },
      model,
      name,
      provider,
      // Its text is shown as it is written (@yaks/session run.ts `step`).
      streaming: true,
      context: shown,
      tools: delegate ? sessionTools(g).filter((t) => t.name == 'spawn') : [],
      // A child works for the same space and person as the session that
      // started it, and is charged to that space.
      prepareChild: async ({ parent }) => {
        let o = await workingOf(store, parent)
        return o ? { operator_session: o } : {}
      },
      remote: async (session) => {
        let { space, ctx, files } = await working(env, store, session)
        return [
          ...await operatorRoster(ctx, store),
          platformBug(space),
          ...options.tools?.(ctx, files) ?? [],
        ]
      },
      instructions: async (session) => {
        let { space, ctx } = await working(env, store, session)
        let [row] = await g.get([session])
        let asks = delegate && !row?.spawned
        return `${instructions(env)}\n\n${await standing(ctx)
          .notes()}\n\nYou work for the owner of ${space.slug}. Carry out this task using the space's existing apps and rows. Read the app's schema and rows before changing data. Make the requested change, then explain what changed and the next step. Ask when required details are missing; never invent meeting dates, times or legal text. A request may be an idea or a design prepared by another agent. Your conversation and tools are recorded on its task. Use task_update with status done on this task only when the requested work is finished. Leave it open when asking a question, reporting a limit, or explaining unfinished work.${
          asks
            ? ` For writing or fixing code, or a task that needs careful reasoning, use spawn with model ${delegate} and a prompt that carries everything it needs; its answer comes back to you, and you tell the person.`
            : ''
        }${told(ctx, space)}`
      },
      each: async (step, session) => {
        if (!session) return
        if (ENDED.includes(step.status)) await answered(session)
        options.tell?.(session)
      },
      report: (e, where) => caught(e, { request: 'operator', ...where }),
    }),
  ))

  let ask: Operator['ask'] = async (held, space, args, o = {}) => {
    let text = typeof args.say == 'string' ? args.say.trim() : ''
    let task = typeof args.task == 'string'
      ? args.task
      : o.task ?? crypto.randomUUID()
    let [old] = await g.get([task])
    if (args.task && !old?.task) {
      throw refuse('missing', `no operator task ${task}`)
    }
    if (!text) throw refuse('arguments', 'say what you want done')
    await seeding()
    let links = old ? await g.read(`.contains .edge.from=${task}`) : []
    let newest = (await g.get(links.map((b) => String(comp(b, 'edge')!.to))))
      .filter((b) => b.session)
      .sort((a, b) =>
        String(comp(a, 'created')?.at).localeCompare(
          String(comp(b, 'created')?.at),
        )
      ).at(-1)
    let session = newest?.entity.eid ?? o.session ?? crypto.randomUUID()
    let by = o.by ?? held.person
    let input = o.request
      ? derivedEid('operator-input|' + o.request)
      : crypto.randomUUID()
    let [sent] = await g.get([input])
    if (sent) return { task, session, input }
    await g.apply([
      {
        entity: { eid: space.eid },
        doc: { title: `${space.slug}'s operator` },
        project: {},
        persona: {},
      },
      { entity: { eid: held.person }, person: {} },
      ...old
        ? [{ entity: { eid: task }, completed: null, cancelled: null }]
        : [{
          entity: { eid: task },
          task: {},
          doc: { title: text.split('\n')[0].slice(0, 160), body: text },
          filed: { project: space.eid },
          $actor: { by },
        }],
    ], { trusted: true })
    if (!newest) {
      await begin(g, undefined, {
        eid: session,
        persona: space.eid,
        by,
        project: space.eid,
        using,
      })
      await g.apply([{
        entity: { eid: crypto.randomUUID() },
        edge: { from: task, to: session },
        contains: {},
      }])
    }
    // Whoever carries the task on, the newest words' reach applies.
    let files = [
      ...new Map(
        [...(await workingOf(store, session))?.files ?? [], ...o.files ?? []]
          .map((f) => [f.key, f]),
      ).values(),
    ]
    let [row] = await g.get([task])
    await g.apply([
      {
        entity: { eid: session },
        operator_session: {
          space: space.eid,
          person: held.person,
          ...held.administrative ? { administrative: true } : {},
          ...files.length ? { files } : {},
        },
      },
      ...old
        ? [{
          entity: { eid: derivedEid('operator-comment|' + input) },
          comment: { target: task },
          doc: { body: text },
          $actor: { by },
        }]
        : [],
      {
        entity: { eid: input },
        entry: { session },
        content: { body: newest ? text : JSON.stringify({ task: row }) },
        ...o.request && o.files?.length
          ? { operator_files: { request: o.request, files: o.files } }
          : {},
        using,
        $actor: { by, via: session },
      },
    ], { trusted: true })
    options.tell?.(session)
    return { task, session, input }
  }

  let run: Operator['run'] = async (held, space, args, o = {}) => {
    let { task, session, input } = await ask(held, space, args, o)
    let entries = await transcript(g, session)
    while (!ENDED.includes(statusOf(entries))) {
      let next = await drain(store)
      entries = await transcript(g, session)
      if (ENDED.includes(statusOf(entries)) || next == null) break
      await new Promise((ok) =>
        setTimeout(ok, Math.min(1000, Math.max(0, next - Date.now())))
      )
    }
    let mine = entries.slice(entries.findIndex((b) => b.entity.eid == input))
    return {
      task,
      session,
      text: replyOf(mine).text,
      status: statusOf(entries),
      cost: mine.reduce(
        (sum, b) => sum + Number(comp(b, 'cost')?.dollars ?? 0),
        0,
      ),
      model: name,
    }
  }

  // The harness's interrupt (runtime.ts): a stop that withdraws the step in
  // flight, its model request or tool call, and that no step goes on past
  // (@yaks/session run.ts `withdrawn`).
  let stop: Operator['stop'] = async (task, by) => {
    let links = await g.read(`.contains .edge.from=${task}`)
    let newest = (await g.get(links.map((b) => String(comp(b, 'edge')!.to))))
      .filter((b) => b?.session)
      .sort((a, b) =>
        String(comp(a, 'created')?.at).localeCompare(
          String(comp(b, 'created')?.at),
        )
      ).at(-1)
    if (!newest) throw refuse('missing', `no operator task ${task}`)
    let session = newest.entity.eid
    if (
      !['pending', 'running'].includes(statusOf(await transcript(g, session)))
    ) {
      return { task, session, stopped: false }
    }
    await g.apply([
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        stop: {},
        content: { body: 'Stopped by the person watching.' },
        $actor: { by, via: session },
      },
    ], { trusted: true })
    await answered(session)
    options.tell?.(session)
    return { task, session, stopped: true }
  }

  return { store, reads, ask, run, stop }
}

export type Asking = {
  // Who the task and its session are by: the person asking, unless the
  // Operator started the work itself (a break, unseen.ts `fix`).
  by?: string
  // The request the words came in, which makes giving them again a no-op.
  request?: string
  session?: string
  task?: string
  files?: File[]
}
type Asker = Pick<Held, 'person' | 'administrative'>
export type Operator = {
  store: Store
  /** What its model reads as it is, beside text (claude.ts `readsOf`). */
  reads: Record<string, number>
  /** Words on a task: a new task and session, or the next input of the
   * task's newest session. Answers at once with where they went. */
  ask: (
    held: Asker,
    space: Space,
    args: Args,
    o?: Asking,
  ) => Promise<{ task: string; session: string; input: string }>
  /** Stop the task's running session at once, the step in flight included:
   * nothing more is done until new words reopen it. */
  stop: (
    task: string,
    by: string,
  ) => Promise<{ task: string; session: string; stopped: boolean }>
  /** operator_run's door: the words, then the answer once the session ends,
   * working the pool meanwhile as the object's alarm does. */
  run: (held: Asker, space: Space, args: Args, o?: Asking) => Promise<{
    task: string
    session: string
    text: string
    status: string
    cost: number
    model: string
  }>
}
