// The Builder's namespace, independent of a Store host. The fixture supplies
// object state; each named conversation keeps the production Builder.
//
// A restart (`ctx.abort`) ends the incarnation as the runtime's does: the next
// request meets a new Builder on the same state, and an answer still on its
// way to its caller when the restart came fails in the restart's words.
import { Builder, type State } from './build.ts'
import type { Env } from './env.ts'

type Incarnation = { builder: Builder; ended?: string }

export let builders = (env: () => Env, state: (name: string) => State) => {
  let states = new Map<string, State>()
  let alive = new Map<string, Incarnation>()
  let stateOf = (name: string): State => {
    let found = states.get(name)
    if (found) return found
    let made = state(name), abort = made.abort
    if (abort) {
      made.abort = (reason?: string) => {
        let now = alive.get(name)
        if (now) now.ended = reason ?? 'Durable Object reset because aborted'
        alive.delete(name)
        abort.call(made, reason)
      }
    }
    states.set(name, made)
    return made
  }
  let incarnation = (name: string): Incarnation => {
    let found = alive.get(name)
    if (!found) {
      alive.set(name, found = { builder: new Builder(stateOf(name), env()) })
    }
    return found
  }
  // The answer crosses to its caller a turn after the object gives it.
  let crossed = async (one: Incarnation, answer: Response) => {
    await new Promise((done) => setTimeout(done, 0))
    if (one.ended) throw new Error(one.ended)
    return answer
  }
  return {
    builder: (name: string) => incarnation(name).builder,
    namespace: {
      idFromName: (name: string) => name,
      get: (name: unknown) => ({
        fetch: async (request: Request) => {
          let one = incarnation(String(name))
          return crossed(one, await one.builder.fetch(request))
        },
      }),
    },
  }
}
