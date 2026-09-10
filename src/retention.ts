// Map insertion order is the LRU. Reads touch; enumeration does not. The same
// bound applies to boot hydration, so an old whole-graph IDB cannot grow RAM.
export const RETENTION_ROWS = 20_000

export let retention = <T>(limit = RETENTION_ROWS) => {
  let rows = new Map<string, T>()
  return {
    rows,
    get: (eid: string) => {
      let row = rows.get(eid)
      if (row !== undefined) {
        rows.delete(eid)
        rows.set(eid, row)
      }
      return row
    },
    put: (eid: string, row: T) => {
      rows.delete(eid)
      rows.set(eid, row)
      let gone: string[] = []
      while (rows.size > limit) {
        let first = rows.keys().next().value!
        rows.delete(first)
        gone.push(first)
      }
      return gone
    },
  }
}
