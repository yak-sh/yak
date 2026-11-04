// The Builder's namespace, independent of a Store host. The fixture supplies
// object state; each named conversation keeps the production Builder.
import { Builder, type State } from './build.ts'
import type { Env } from './env.ts'

export let builders = (env: () => Env, state: (name: string) => State) => {
  let held = new Map<string, Builder>()
  let builder = (name: string): Builder => {
    let found = held.get(name)
    if (!found) held.set(name, found = new Builder(state(name), env()))
    return found
  }
  return {
    builder,
    namespace: {
      idFromName: (name: string) => name,
      get: (name: unknown) => ({
        fetch: (request: Request) =>
          Promise.resolve(builder(String(name)).fetch(request)),
      }),
    },
  }
}
