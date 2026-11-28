// yaks.app's own provider keys (ElevenLabs, Deepgram and the rest): the
// connections its own space (`yak`) holds, which its `platform` app uses, each
// under the name the Worker reads it by (`ELEVENLABS_API_KEY`), as any app's
// code reads env.NAME. A held key is imported by the platform admin. A key
// nobody holds can be given on the space's connections page.
//
// `keyed` is the Worker's env with those keys over any Worker secret of the
// same name, which answers only until its connection is given. An isolate
// reads them again once a minute (`FRESH`), so a key given or replaced
// reaches every isolate within about that.
import { PLATFORM_STORE } from '@yaks/platform/names'
import { overlaid } from '@yaks/host/config'
import { turns } from '@yaks/fp'
import { line } from '@yaks/query'
import { caught } from './defects.ts'
import type { Env } from './env.ts'
import { inFlight } from './lib/shared.ts'
import { vaulted } from './vault.ts'

let FRESH = 60_000

type Held = {
  /** the env the isolate was handed */
  base: Record<string, unknown>
  /** the keys read, by name */
  keys: Record<string, string>
  /** the one object handed out for it while the isolate lives, reading the
   * keys over the env, so what holds it (an Operator) sees every refresh */
  env: Record<string, unknown>
  /** when the keys were last read */
  at: number
  turn: ReturnType<typeof turns>
}

// By the env the isolate was handed, and by its overlay, so keying an
// overlay again is keying its env.
let held = new WeakMap<object, Held>()

/** `env` with yaks.app's own keys over its secrets of the same names. The
 * first ask in an isolate waits for them; one after they are a minute old
 * reads them again behind it, so no request waits on a refresh. A read that
 * fails is reported and keeps what was read before. */
export let keyed = async <E extends object>(env: E): Promise<E> => {
  let h = overlay(env)
  let now = Date.now()
  if (now - h.at < FRESH) return h.env as E
  let first = h.at == -Infinity
  if (!first) h.at = now
  let read = inFlight(held, h, async () => {
    // Overlapping cold requests share the completed keys. Each waits in its
    // own request context so a cancelled request cannot swallow its wake.
    let { ready, end, gone } = h.turn()
    try {
      await ready
      if (first && h.at != -Infinity) return
      let keys = await platformKeys(h.base)
      if (!gone()) h.keys = keys
    } catch (e) {
      caught(e, { request: 'platform keys' })
    } finally {
      if (!gone()) h.at = Math.max(h.at, now)
      end()
    }
  })
  if (first) await read
  return h.env as E
}

/** `env`'s overlay as last read, without reading: the object `keyed`
 * refreshes, for what holds an env from before its first request. */
export let keysOn = <E extends object>(env: E): E => overlay(env).env as E

/** The Worker binding before any platform connection overlays it. */
export let workerKey = (env: Env, name: string): string | undefined => {
  let value = overlay(env).base[name]
  return typeof value == 'string' ? value : undefined
}

let overlay = (env: object): Held => {
  let h = held.get(env)
  if (h) return h
  let base = env as Record<string, unknown>
  let made: Held = { base, keys: {}, env: base, at: -Infinity, turn: turns() }
  made.env = overlaid(base, () => made.keys)
  held.set(env, made)
  held.set(made.env, made)
  return made
}

/** The keys the `platform` app's connections hold, by binding name. Inside
 * the directory, `ctxOf` reads through the local `META` door. */
export let platformKeys = async (
  env: Partial<Env>,
): Promise<Record<string, string>> => {
  if (!env.STORE || !vaulted(env)) return {}
  let [{ keysOf }, { ctxOf }] = await Promise.all([
    import('@yaks/connections'),
    import('./connections.ts'),
  ])
  let c = ctxOf({ ...env, STORE: env.STORE })
  let [app] = await c.graph.read(line`.app.store=${PLATFORM_STORE}`)
  return app ? await keysOf(c, app.entity.eid) : {}
}
