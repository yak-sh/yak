import type { Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { statusComputed } from '@yaks/session/status'
import { attemptComputed } from '../../packages/session/attempt.ts'
import { executionComputed } from '@yaks/tools'
import { operatorGraph, operatorVocab } from './operator-store.ts'
import type { Model } from '@yaks/model'
import { assertEquals } from '@std/assert'
import { refusing } from './defects.ts'
import type { Held } from './build.ts'
import type { Env } from './env.ts'
import { operating, type Options } from './operator.ts'
import {
  type Listener,
  operatorFrames,
  operatorRequest,
} from './operator-host.ts'
import { attachmentTools, handleChannels } from './operator-channels.ts'
import { drain } from './operator-store.ts'

// A test's Operator model, answered by whatever `answer` is when it is asked:
// one Operator per store, its script changed between requests.
export let operatorModel = (answer: Model) => {
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
      info: () => Promise.resolve({ name, price, context: 1000 }),
    }),
  }
}

/** Session decisions use the same graph composition over rows in memory. */
export let operatorMemory = (storage: Storage = ram(operatorVocab, {
  computed: { ...statusComputed, ...attemptComputed, ...executionComputed },
})) => ({ ...operatorGraph(storage, []), storage })

/** The Operator's HTTP and page-frame handlers over a private RAM graph. */
export let operatorService = (env: Env, held: Held, options: Options) => {
  let store = operatorMemory()
  let sockets: Listener[] = []
  let frames = operatorFrames(store, () => sockets)
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
    assertEquals(req.headers.get('x-yak-person'), held.person)
    assertEquals(req.headers.get('x-space-eid'), held.space)
    try {
      let response = await operatorRequest(
        operator,
        held,
        new URL(req.url).pathname,
        await req.json(),
        () => undefined,
      )
      if (!response) throw new Error(`Unhandled Operator route: ${req.url}`)
      return response
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
