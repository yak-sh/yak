// An attempt a person begins here and an outside service finishes: they are
// sent to its sign-in page with a random `state`, and it sends them back with
// that `state` to a door at the apex. What the door needs to finish (who
// began it, for which space, the page to bring them back to) waits in the
// vault under the `state`, never in the browser: the return may land in
// another browser, and nothing it carries is believed but the `state`. It is
// taken on the way in, so it finishes once.
//
// connections.ts holds a connection's sign-in this way, and sell.ts a seller
// connecting the payment account they already have.
import { reveal, sealed, secretEid, unsealed } from '@yaks/secrets'
import type { Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import { vaultOf } from './vault.ts'

// The vault's name for an attempt of one kind waiting on its return.
let nameOf = (kind: string, state: string) => `${kind}:${state}`

/** Keep what an attempt of `kind` needs to finish until its return names
 * `state`. */
export let hold = async (
  env: Partial<Env> & Pick<Env, 'STORE'>,
  kind: string,
  state: string,
  value: unknown,
) => {
  await meta(env).apply(
    [sealed(nameOf(kind, state), JSON.stringify(value))],
    KERNEL,
  )
}

/** What an attempt of `kind` was held with, taken so no other return can
 * finish it; null for a `state` that names none, or one already taken. */
export let take = async <T>(
  env: Partial<Env> & Pick<Env, 'STORE'>,
  kind: string,
  state: string | null,
): Promise<T | null> =>
  await finish<T, T>(env, kind, state, (value) => Promise.resolve(value))

/** Read a held attempt before the person confirms it. */
export let waiting = async <T>(
  env: Partial<Env> & Pick<Env, 'STORE'>,
  kind: string,
  state: string,
): Promise<T | null> => {
  let text = await reveal(vaultOf(env), nameOf(kind, state), {
    env: () => undefined,
  })
  return text ? JSON.parse(text) as T : null
}

/** Finish an attempt once, keeping it available if the write fails. */
export let finish = async <T, R>(
  env: Partial<Env> & Pick<Env, 'STORE'>,
  kind: string,
  state: string | null,
  run: (value: T) => Promise<R>,
): Promise<R | null> => {
  if (!state) return null
  let name = nameOf(kind, state)
  let vault = vaultOf(env)
  return await vault.lock(secretEid(name), async () => {
    let value = await waiting<T>(env, kind, state)
    if (value == null) return null
    let out = await run(value)
    await meta(env).apply([unsealed(name)], KERNEL)
    return out
  })
}
