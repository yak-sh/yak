import type { Bundle, Comp } from '@yaks/graph'

export let ROUTE_MEMORY = 'x-yak-route-memory'
let LIFETIME = 30_000
let LIMIT = 512

type Entry<T> = {
  value: T
  space: string
  since: number
  refreshing?: true
}

/** Each answer ages from the start of its read, including time in flight. */
export let routeMemory = <T>() => {
  let entries = new Map<string, Entry<T>>()
  let generation = 0
  let writing = 0
  return {
    read: async (
      key: string,
      now: () => number,
      fresh: (refreshing?: true) => Promise<T>,
      admits: (value: T) => string | null,
      refresh: (work: () => Promise<void>) => void,
    ): Promise<{ value: T; remembered?: number }> => {
      let read = async (refreshing?: Entry<T>) => {
        let since = now()
        let at = generation
        let value = await fresh(refreshing && true)
        let space = admits(value)
        let held = entries.get(key)
        if (
          at == generation && !writing && now() - since < LIFETIME &&
          (!refreshing || refreshing == held)
        ) {
          if (!held || held.since <= since) {
            entries.delete(key)
            if (space) entries.set(key, { value, space, since })
            if (entries.size > LIMIT) {
              entries.delete(entries.keys().next().value!)
            }
          }
        }
        return value
      }
      let hit = entries.get(key)
      if (hit) {
        let age = now() - hit.since
        if (age < 0 || age >= LIFETIME) entries.delete(key)
        else if (admits(hit.value)) {
          if (age >= LIFETIME / 2 && !hit.refreshing) {
            hit.refreshing = true
            refresh(async () => {
              try {
                await read(hit)
              } finally {
                delete hit.refreshing
              }
            })
          }
          return { value: hit.value, remembered: hit.since + LIFETIME }
        }
      }
      return { value: await read() }
    },
    change: async <R>(spaces: Set<string> | null, write: () => Promise<R>) => {
      generation++
      writing++
      for (let [key, entry] of entries) {
        if (!spaces || spaces.has(entry.space)) entries.delete(key)
      }
      try {
        return await write()
      } finally {
        generation++
        writing--
      }
    },
  }
}

let memories = new WeakMap<object, ReturnType<typeof routeMemory<unknown>>>()

/** One memory per directory binding in this isolate. */
export let routesOf = <T>(binding: object) => {
  let memory = memories.get(binding)
  if (!memory) memories.set(binding, memory = routeMemory())
  return memory as ReturnType<typeof routeMemory<T>>
}

let spaceOf = (bundle: Bundle) => {
  if (bundle.space && bundle.entity.eid) return bundle.entity.eid
  // Transferring an app can affect its old space as well as the one named.
  if ('app' in bundle) return null
  let component = bundle.member as Comp | null | undefined
  let space = component?.space
  return typeof space == 'string' ? space : null
}

/** A partial patch may name just a row. Forget every route if the batch
 * leaves any affected space unspecified. */
export let changingRoutes = <T>(
  binding: object,
  bundles: Bundle[] | null,
  write: () => Promise<T>,
): Promise<T> => {
  let memory = memories.get(binding)
  if (!memory) return write()
  let spaces = bundles?.map(spaceOf)
  return memory.change(
    spaces?.every((space) => space != null) ? new Set(spaces) : null,
    write,
  )
}

/** A request to the directory's store, sent by `send`: a write forgets the
 * routes it may move, whichever door made it. A read goes straight through.
 * An `/apply` names its bundles; any other write forgets every route. */
export let routedWrite = async <T>(
  binding: object,
  req: Request,
  send: () => Promise<T>,
): Promise<T> => {
  if (req.method == 'GET' || req.method == 'HEAD' || !memories.has(binding)) {
    return send()
  }
  let bundles = new URL(req.url).pathname == '/apply'
    ? await req.clone().json().catch(() => null)
    : null
  return changingRoutes(binding, Array.isArray(bundles) ? bundles : null, send)
}
