import { type Clock, system as runtimeClock } from '@yaks/fp'
import type { Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { statusComputed } from '@yaks/session/status'
import { attemptComputed } from '../../packages/session/attempt.ts'
import { executionComputed } from '@yaks/tools'
import {
  type Bound,
  memoryPlan,
  NUMBERS,
  operatorGraph,
  operatorVocab,
} from './operator-store.ts'
import type { Listed, Model, Price, Request as Ask } from '@yaks/model'
import { choosing } from '@yaks/platform/operator-model'
import { KERNEL, meta } from './meta.ts'
import { assertEquals } from '@std/assert'
import { until } from '@yaks/testing'
import { background, caught, refusing } from './defects.ts'
import { type Held, SEATED } from './build-door.ts'
import { HEARD } from './door.ts'
import type { Env } from './env.ts'
import { operatorPost } from './metered.ts'
import { operating, type Operator, type Options } from './operator.ts'
import { chat, converse, ended } from './operator-conversations.ts'
import type { Space } from './directory.ts'
import {
  operatorFrames,
  operatorReply,
  operatorRequest,
} from './operator-host.ts'
import type { Frame } from '@yaks/api'
import { operatorTalk, type Told } from '@yaks/platform/operator-talk'
import {
  attachmentTools,
  handleChannels,
  heardAt,
} from './operator-channels.ts'
import { drain } from './operator-store.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Host } from '@yaks/markdown'
import { Folds } from '@yaks/ux/conversation'
import { opening } from '@yaks/session/conversation'
import { drawLines, type Lines } from './operator-draw.ts'
import type { Row } from './operator-view.ts'

/** What an ask could call: the tools it was sent, and the ones `tool_load`
 * lists for it to load (@yaks/session `tool_load`). */
/** operator_chat as the Builder answers it, with the store worked while
 * it waits, as its alarm would, for up to the Builder's wait on `clock`.
 * The work goes on behind the answer. */
export let chatted = (
  operator: Operator,
  held: Parameters<Operator['chats']>[0],
  space: Space,
  args: Record<string, unknown>,
  clock: Clock = runtimeClock,
) =>
  chat(operator, held, space, args, async (session) => {
    let work = (async () => {
      for (;;) {
        let next = await drain(operator.store, undefined, operator.watching)
        if (next == null || await ended(operator.store.g, session)) return
        await new Promise<void>((ok) =>
          clock.after(Math.min(1000, Math.max(0, next - clock.now())), ok)
        )
      }
    })()
    background(
      work.catch((e) => caught(e, { request: 'operator run', session })),
    )
    let cancel = () => {}
    await Promise.race([
      work,
      new Promise<void>((done) => cancel = clock.after(25_000, done)),
    ]).finally(() => cancel())
  })

export let callable = (req: Pick<Ask, 'tools' | 'turnContext'>): string[] => [
  ...req.tools.map((t) => t.name),
  ...[
    req.tools.find((t) => t.name == 'tool_load')?.description,
    ...req.turnContext?.flatMap((i) =>
      i.kind == 'instruction' ? [i.text] : []
    ) ?? [],
  ].filter(Boolean).join('\n')
    .matchAll(/^- (\w+):/gm).map((m) => m[1]),
]

/** What the model sees for a turn, including context sent beside the transcript. */
export let promptOf = ({ items, turnContext }: Ask): string =>
  JSON.stringify([...items, ...turnContext ?? []])

/** Make `model`, priced at `price` with a window of `context` tokens, the
 * one every Operator runs on, served by `provider`: the rows `yak admin model`
 * writes in the directory. */
export let operatorOn = (
  env: Pick<Env, 'STORE' | 'META' | 'CLOCK'>,
  provider: string,
  model: string,
  price: Price,
  context = 200_000,
) =>
  meta(env).apply(
    choosing(
      { entity: { eid: model }, model: { name: model, context }, price },
      provider,
    ),
    KERNEL,
  )

// A test's Operator model, answered by whatever `answer` is when it is asked:
// one Operator per store, its script changed between requests.
export let operatorModel = (
  answer: Model,
  limits: Pick<Listed, 'context' | 'output'> = {},
) => {
  let name = 'test-model'
  let price = { input: 1, output: 0 }
  let model: Model = async (req) => {
    let reply = await answer(req)
    return {
      ...reply,
      usage: { input_tokens: (reply.cost ?? 0) * 1e6, output_tokens: 0 },
    }
  }
  return {
    name,
    price,
    model: Object.assign(model, {
      info: () => Promise.resolve({ name, price, context: 1000, ...limits }),
    }),
  }
}

// RAM effect passes yield to asynchronous work without waiting for a timer.
let clock: Clock = {
  ...runtimeClock,
  after: (ms, callback) => {
    if (ms > 0) return runtimeClock.after(ms, callback)
    let pending = true
    queueMicrotask(() => {
      if (pending) callback()
    })
    return () => void (pending = false)
  },
}

let plan = await memoryPlan()

/** Session decisions use the same graph composition over rows in memory. */
export let operatorMemory = (
  storage: Storage = ram(operatorVocab, {
    number: NUMBERS,
    computed: { ...statusComputed, ...attemptComputed, ...executionComputed },
  }),
  options: Bound['effects'] = {},
  senders: Bound['senders'] = {},
) => ({
  ...operatorGraph(plan, {
    storage: () => storage,
    senders,
    effects: { clock, ...options },
  }),
  storage,
})

/** The Operator's HTTP and page-frame handlers over a private RAM graph, or
 * over `store`, for what a RAM graph lacks (ranked text search). */
export let operatorService = (
  env: Env,
  held: Held,
  options: Options,
  store: ReturnType<typeof operatorGraph> = operatorMemory(undefined, {}, {
    operator: operatorPost(env),
  }),
) => {
  let frames = operatorFrames(store, (person) => operator.named(person))
  let pending: Promise<void>[] = []
  let operator = operating(store, env, {
    tools: attachmentTools(env),
    ...options,
    tell: (session) => void pending.push(frames.tell(session)),
    typing: (session, text) => void pending.push(frames.typing(session, text)),
  })
  handleChannels(operator, env)
  let fetch = async (req: Request) => {
    assertEquals(req.method, 'POST')
    let path = new URL(req.url).pathname
    // What a commit the space's subscriptions read stirs them with, as the
    // Builder answers it (build.ts `HEARD`), and a seat moving in the space
    // (build.ts `SEATED`), which has no page sockets to hold seats here and
    // is answered 204 whether or not anything watches, as the Builder does.
    if (
      (path == HEARD || path == SEATED) &&
      req.headers.get('x-yak-kernel') == '1'
    ) {
      let { heard } = await import('./operator-schedules.ts')
      let at = await heard(store, false)
      let gone = at == null && path == HEARD
      return new Response(null, { status: gone ? 410 : 204 })
    }
    assertEquals(req.headers.get('x-space-eid'), held.space)
    // A reply to the Operator's letter, which the kernel brings for its
    // writer.
    if (req.headers.get('x-yak-kernel') == '1') {
      if (path.startsWith('/result/')) {
        let { resultRequest } = await import('./result-host.ts')
        let args = await req.json() as Record<string, unknown>
        return await resultRequest(
          store.g,
          path.slice('/result/'.length),
          args,
          String(args.reader),
        ) ?? new Response(null, { status: 404 })
      }
      return operatorReply(
        operator,
        held.space,
        path,
        await req.json(),
        () => undefined,
        req.headers.get('x-yak-person'),
      )
    }
    assertEquals(req.headers.get('x-yak-person'), held.person)
    try {
      let args = await req.json()
      let response = await operatorRequest(
        operator,
        held,
        path,
        args,
        () => undefined,
      )
      if (response) return response
      if (
        path == '/operator/run' || path == '/operator/helper' ||
        path == '/operator/settings' || path == '/operator/talk' ||
        path == '/operator/receive'
      ) {
        let { directoryOf } = await import('./directory.ts')
        let space = await directoryOf(env.STORE).at(held.space)
        if (!space) throw new Error('Operator space is missing')
        if (path == '/operator/settings') {
          let { setting } = await import('./operator-persona.ts')
          return Response.json(
            await setting(
              store.g,
              space,
              held.person,
              args.set,
              (entities) => directoryOf(env.STORE).apply({ entities }),
            ),
          )
        }
        if (path == '/operator/receive') {
          return await heardAt(operator, env, held, space, args)
        }
        if (path == '/operator/helper') {
          let { spawnHelper } = await import('./operator-helpers.ts')
          return Response.json(await spawnHelper(operator, held, space, args))
        }
        if (path == '/operator/talk') {
          return Response.json(
            await converse(operator, held, space, args.tool, args.args),
          )
        }
        return Response.json(
          await chatted(operator, held, space, args, env.CLOCK),
        )
      }
      throw new Error(`Unhandled Operator route: ${req.url}`)
    } catch (e) {
      return Response.json({ message: (e as Error).message }, {
        status: refusing(e, { request: 'operator' }),
      })
    }
  }
  let binding: Env['BUILDER'] = {
    idFromName: (name) => name,
    get: (name) => {
      assertEquals(name, held.space)
      return { fetch }
    },
  }
  return {
    binding,
    frames,
    store,
    drain: async () => {
      await drain(store, undefined, operator.watching)
      await Promise.all(pending.splice(0))
    },
    // Tap Approve on every act waiting for a tap, as its person signed in
    // (operator-approvals.ts).
    approve: async () => {
      let { digestOf } = await import('./operator-approvals.ts')
      let waiting = await store.g.read('.operator_approval !verified')
      let rows = await store.g.get(waiting.map((r) => r.entity.eid))
      return Promise.all(rows.map((r) => {
        let a = r.operator_approval as Parameters<typeof digestOf>[0]
        return operator.approve(r.entity.eid, digestOf(a), {
          press: true,
          who: a.person,
        })
      }))
    },
  }
}

/** An app the person made and released, as their Operator makes one
 * (tools.ts `app_new`, `app_files`, `app_deploy`), for the chat to draw
 * beside it. */
export let released = async (ctx: Ctx, slug: string, title: string) => {
  let run = (name: string, args: Record<string, unknown>) =>
    TOOLS.find((t) => t.name == name)!.run(ctx, args)
  await run('app_new', { slug, title })
  await run('app_files', {
    app: slug,
    files: [{ path: 'index.html', content: `<h1>${title}</h1>` }],
  })
  await run('app_deploy', { app: slug })
}

/** Each line a frame sends, drawn as HTML as the page draws it, under its id
 * (operator-talk.ts), with its ids opening at `mentions`. */
export let sentRows = (sent: Lines, mentions?: string): Row[] =>
  drawLines(sent).map(({ id, node }) => ({
    id,
    html: renderToString(
      h(
        Host.Provider,
        { value: opening(mentions) },
        h(Folds, { line: id }, node),
      ),
    ),
  }))

/** A chat page's watch of `person`'s conversation `task` (none for a new
 * chat) with the Operator of `space`, on its `frames` (operator-host.ts
 * `operatorFrames`): every frame it heard, the steps among them (each a
 * step's frame, as the page hears it), and the words of a reply it heard
 * written. Steps are heard once it is `ready`. */
export let talking = (
  frames: Pick<ReturnType<typeof operatorFrames>, 'talks'>,
  person: string,
  space: string,
  task?: string,
) => {
  let heard: Frame[] = []
  frames.talks.open(
    (f) => void heard.push(f),
    'talk',
    operatorTalk(space, task),
    { person },
  )
  let told = () =>
    heard.flatMap((f) => f.bundles ?? []).map((b) => b.operatorTalk as Told)
  return {
    heard,
    told,
    steps: () => told().flatMap((t) => t.step ? [t.step] : []),
    typed: () =>
      heard.flatMap((f) => f.transient ?? []).map((t) => t.text ?? '').join(
        '',
      ),
    ready: () => until(() => heard.length > 0, { label: 'its answer' }),
  }
}
