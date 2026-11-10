import { type Clock, system as runtimeClock } from '@yaks/fp'
import type { Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { statusComputed } from '@yaks/session/status'
import { attemptComputed } from '../../packages/session/attempt.ts'
import { executionComputed } from '@yaks/tools'
import { operatorGraph, operatorVocab } from './operator-store.ts'
import type { Listed, Model } from '@yaks/model'
import { assertEquals } from '@std/assert'
import { refusing } from './defects.ts'
import type { Held } from './build-door.ts'
import type { Env } from './env.ts'
import { operating, type Options } from './operator.ts'
import {
  type Listener,
  operatorFrames,
  operatorReply,
  operatorRequest,
} from './operator-host.ts'
import { attachmentTools, handleChannels } from './operator-channels.ts'
import { drain } from './operator-store.ts'
import { type Ctx, TOOLS } from './tools.ts'

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

/** Session decisions use the same graph composition over rows in memory. */
export let operatorMemory = (
  storage: Storage = ram(operatorVocab, {
    computed: { ...statusComputed, ...attemptComputed, ...executionComputed },
  }),
  options: Parameters<typeof operatorGraph>[2] = {},
) => ({ ...operatorGraph(storage, [], { clock, ...options }), storage })

/** The Operator's HTTP and page-frame handlers over a private RAM graph. */
export let operatorService = (env: Env, held: Held, options: Options) => {
  let store = operatorMemory()
  let sockets: Listener[] = []
  let frames = operatorFrames(
    store,
    () => sockets,
    (person) => operator.named(person),
  )
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
    assertEquals(req.headers.get('x-space-eid'), held.space)
    let path = new URL(req.url).pathname
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
        path == '/operator/settings'
      ) {
        let { directoryOf } = await import('./directory.ts')
        let space = await directoryOf(env.STORE).at(held.space)
        if (!space) throw new Error('Operator space is missing')
        if (path == '/operator/settings') {
          let { setting } = await import('./operator-persona.ts')
          return Response.json(
            await setting(store.g, space, held.person, args.set),
          )
        }
        return Response.json(
          await (path == '/operator/helper'
            ? operator.helper(held, space, args)
            : operator.run(held, space, args)),
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
    sockets,
    store,
    drain: async () => {
      await drain(store)
      await Promise.all(pending.splice(0))
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
