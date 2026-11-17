// A durable index of trackers whose bugs moved. The last revision of every
// scope is retained, so a reader may resume from any tag of this era.
export type Index = {
  era: string
  count: number
  scopes: Record<string, { count: number; tag?: string }>
}

export let index = (scopes: string[]): Index => ({
  era: crypto.randomUUID(),
  count: 0,
  scopes: Object.fromEntries(scopes.map((scope) => [scope, { count: 0 }])),
})

export let moved = (held: Index, scope: string, tag?: string): Index => {
  let was = held.scopes[scope]
  if (was && (!tag || was.tag == tag)) return held
  let count = held.count + 1
  return {
    ...held,
    count,
    scopes: { ...held.scopes, [scope]: { count, tag } },
  }
}

export let changes = (held: Index, since?: string | null) => {
  let tag = `"${held.era}.${held.count}"`
  let [era, count] =
    since?.replace(/^W\//, '').replaceAll('"', '').split('.') ?? []
  let after = era == held.era && /^\d+$/.test(count) &&
      Number(count) <= held.count
    ? Number(count)
    : -1
  return {
    tag,
    scopes: Object.entries(held.scopes)
      .filter(([, scope]) => scope.count > after)
      .map(([scope, { count }]) => ({ scope, tag: `${held.era}.${count}` })),
  }
}

type Kept = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
}

// One serialized writer: concurrent intake from different scopes must not
// overwrite each other's revisions. Failed persistence leaves the old index.
export let directory = (kept: Kept, scopes: () => Promise<string[]>) => {
  let held: Index | undefined, tail: Promise<unknown> = Promise.resolve()
  let serial = <T>(work: (held: Index) => T | Promise<T>) => {
    let ran = tail.then(async () => {
      if (!held) {
        held = await kept.get<Index>('scope-changes')
        if (!held) {
          let first = index(await scopes())
          await kept.put('scope-changes', first)
          held = first
        }
      }
      return await work(held)
    })
    tail = ran.catch(() => {})
    return ran
  }
  return {
    read: (since?: string | null) => serial((held) => changes(held, since)),
    move: (scope: string, tag?: string) =>
      serial(async (was) => {
        let next = moved(was, scope, tag)
        if (next == was) return
        await kept.put('scope-changes', next)
        held = next
      }),
  }
}
