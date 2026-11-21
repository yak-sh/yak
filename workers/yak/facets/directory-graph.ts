// A person's own space minted inside the write that mints it (T-148852): the
// request `$own{person, want?}` becomes the batch directory.ts `owning`
// decides over this transaction's own reads, so it reads the person's seats,
// their row and which addresses are free as the write finds them. Two asks at
// once (a sign-in settling behind its answer, and the first page it sent the
// person to) are two transactions one after the other, and the second finds
// the first's seat and writes nothing. Before, the gateway read, decided and
// wrote in five trips, and an ask landing between another's reads minted a
// second space at the next free address.
//
// The platform's alone: what it writes is the kernel's (a person's `started`,
// a space's `starter`), so a request that is not trusted is refused.
//
// A seat written in a space, or taken away, tells the space's Operator
// (`seatsHeard`), as an app's commit does (graph.ts `#herald`): its
// subscriptions over the space look again a beat later (build.ts `HEARD`),
// and one watching member_list sees the role change within seconds.
import type { Bundle, Hook, Plugin } from '@yaks/graph'
import { hook, type HookContext } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { dead, TOMBSTONE } from '@yaks/graph/bundle'
import { after, each } from '@yaks/fp'
import { idOf, inside } from '../directory.ts'
import { reclaimFiles } from '../file-retirement-graph.ts'
import { caught } from '../defects.ts'
import type { Env } from '../env.ts'
import type { Options } from './store.ts'

type Own = { person: string; want?: string }

// The space a seat among `rows` is in.
let spacesOf = (rows: Bundle[]) =>
  rows.flatMap((r) =>
    r.member ? [idOf((r.member as { space: string }).space)] : []
  )

// The entities a batch deletes.
let killing = (bundles: Bundle[]) => [
  ...new Set(bundles.filter(dead).map((b) => b.entity.eid)),
]

/** Each space whose seats a commit wrote or took away, told to its Operator
 * (build-door.ts `heard`). A seat taken away is read before it goes. */
export let seatsHeard = (
  { store }: Options,
  tell = async (env: Env, space: string) => {
    let { heard } = await import('../build-door.ts')
    await (await heard(env, space)).body?.cancel()
  },
): Plugin => {
  let left = new WeakMap<object, string[]>()
  let leaving = hook(['$delete', TOMBSTONE], (bundles, tx, _err, context) => {
    let at = context?.transaction
    let killed = killing(bundles)
    if (!at || !killed.length) return bundles
    return after(tx.get(killed), (rows) => {
      left.set(at, spacesOf(rows))
      return bundles
    })
  })
  let effect: Hook = Object.assign(
    async (
      applied: Bundle[],
      tx: Parameters<Hook>[1],
      _err?: unknown,
      context?: HookContext,
    ) => {
      let { env, meta } = store
      if (!meta || !env.BUILDER) return applied
      let wrote = applied.filter((b) => b.member && !b.tombstone)
        .map((b) => b.entity.eid)
      // A space born in this very commit has no Operator to tell yet.
      let born = new Set(
        applied.filter((b) => b.space).map((b) => b.entity.eid),
      )
      let spaces = new Set([
        ...context?.transaction && left.get(context.transaction) || [],
        ...wrote.length ? spacesOf(await tx.get(wrote)) : [],
      ].filter((s) => !born.has(s)))
      await Promise.all(
        [...spaces].map((space) =>
          tell(env as Env, space).catch((e) =>
            caught(e, { request: 'tell seats', space })
          )
        ),
      )
      return applied
    },
    { keys: ['member', TOMBSTONE] },
  )
  return {
    name: 'yak/seats',
    admission: () => true,
    wants: (bundles) => {
      let killed = killing(bundles)
      return killed.length ? [{ eids: killed }] : []
    },
    hooks: { precondition: leaving, effect },
  }
}

export let plugins = (_host: unknown, options: Options): Plugin[] => [
  {
    name: 'yak/directory',
    requests: ['$own'],
    authorize: hook(['$own'], (bundles, tx, _err, context) => {
      if (!bundles.some((b) => b.$own)) return bundles
      if (!context?.trusted) {
        throw new Refused('only the platform mints a person their own space')
      }
      return each(
        bundles,
        [] as Bundle[],
        (out, b) => {
          if (!b.$own) return [...out, b]
          let { person, want } = b.$own as Own
          return after(
            inside(tx).owning(person, want),
            (wrote) => [...out, ...wrote],
          )
        },
      )
    }),
  },
  reclaimFiles(),
  seatsHeard(options),
]
