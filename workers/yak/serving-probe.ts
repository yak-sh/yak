import type { Env } from './env.ts'
import { platform as inMemory } from './testing.ts'
import { SECRET } from './serving-data-probe.ts'
import type { ServingCopyDoor } from './directory-copy.ts'
import { ServingCopy, type ServingCopyState } from './serving-copy.ts'
export { ADA, ADA_OWNS, as, seeded, visit } from './serving-data-probe.ts'

/** The platform in memory, with `vars` beside its own. */
export let platform = (vars: Partial<Env> = {}) => inMemory(SECRET, vars)

/** Production's serving copy behind an RPC-shaped door, which is what gives
 * the directory a revision: `{ SERVING_COPY: { idFromName, get: () => door } }`. */
export let servingCopy = (): ServingCopyDoor => {
  let saved: ServingCopyState | undefined
  let copy = new ServingCopy({
    persistence: { read: () => saved, write: (next) => void (saved = next) },
  })
  return {
    begin: (floor) => Promise.resolve(copy.begin(floor)),
    finish: (revision) => Promise.resolve(copy.finish(revision)),
    revision: () => Promise.resolve(copy.revision),
    settle: (revision, committed) =>
      Promise.resolve(copy.settle(revision, committed)),
    put: (...args) => Promise.resolve(copy.put(...args)),
    get: (key) => Promise.resolve().then(() => copy.get(key)),
    valid: (revision) => Promise.resolve(copy.valid(revision)),
    publish: (...args) => Promise.resolve(copy.publish(...args)),
  }
}
