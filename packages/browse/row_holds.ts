// Concurrent row readers share a bounded immutable request. Each reader keeps
// its own lifetime; the request closes only after its last reader leaves.
export let rowHolds = (
  open: (name: string, query: string) => void,
  close: (name: string) => void,
  later: (run: () => void) => void = queueMicrotask,
) => {
  type Group = { name: string; readers: Set<string> }
  let groups = new Map<string, Group>()
  let held = new Map<string, { ids: string[]; uses: number; group?: Group }>()
  let pending = new Set<string>()
  let queued = false
  let generation = 0
  let start = (names: string[], ids: string[]) => {
    let key = `rows:${ids.join(',')}`
    let group = groups.get(key)
    if (!group) {
      groups.set(key, group = { name: key, readers: new Set() })
      open(key, `id=${ids.join(',')}`)
    }
    for (let name of names) {
      let reader = held.get(name)
      if (reader) {
        group.readers.add(name)
        reader.group = group
      }
    }
  }
  let flush = () => {
    queued = false
    let wave: { names: string[]; ids: Set<string> }[] = []
    for (let name of pending) {
      let reader = held.get(name)
      if (!reader) continue
      let group = wave.at(-1)
      let ids = new Set([...(group?.ids ?? []), ...reader.ids])
      if (!group || ids.size > 60) {
        group = { names: [], ids: new Set(reader.ids) }
        wave.push(group)
      } else group.ids = ids
      group.names.push(name)
    }
    pending.clear()
    for (let group of wave) start(group.names, [...group.ids])
  }
  let hold = (ids: string[]): () => void => {
    if (!ids.length) return () => {}
    let name = `rows:${ids.join(',')}`
    let reader = held.get(name)
    if (reader) reader.uses++
    else {
      reader = { ids: [...ids], uses: 1 }
      held.set(name, reader)
      if (ids.length > 60) start([name], ids)
      else {
        pending.add(name)
        if (!queued) {
          queued = true
          let epoch = generation
          later(() => {
            if (epoch == generation) flush()
          })
        }
      }
    }
    let owned = reader
    let active = true
    return () => {
      if (!active) return
      active = false
      let reader = held.get(name)
      if (reader != owned || --reader.uses) return
      held.delete(name)
      pending.delete(name)
      let group = reader.group
      if (!group) return
      group.readers.delete(name)
      if (!group.readers.size) {
        groups.delete(group.name)
        close(group.name)
      }
    }
  }
  return Object.assign(hold, {
    clear: () => {
      generation++
      queued = false
      pending.clear()
      held.clear()
      groups.clear()
    },
  })
}
