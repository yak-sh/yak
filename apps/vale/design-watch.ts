// A design watch tells its reader only when the designs themselves change.
// Readiness, row order and unrelated graph components can all change while
// the shape the world grows from stays the same.
type Row = { entity: { eid: string }; [name: string]: unknown }

export let watchDesigns = <T extends Row>(
  watch: { ready: boolean; value: T[]; subscribe: (fn: () => void) => unknown },
  name: string,
  use: (rows: T[]) => void,
) => {
  let used: string | undefined
  let update = () => {
    if (!watch.ready) return
    let rows = watch.value
    let parts = rows.map((b): [string, unknown] => [b.entity.eid, b[name]])
    parts.sort(([a], [b]) => a.localeCompare(b))
    let next = JSON.stringify(parts)
    if (next == used) return
    use(rows)
    used = next
  }
  watch.subscribe(update)
  update()
}
