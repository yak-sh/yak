// The vault's one file watch: the hook spool. Never watch the vault root: it
// contains SQLite's db, WAL and SHM, and only the dedicated spool may wake the
// turn drain (T-35631).
export let watchVault = (dir: string, turns: () => void) => {
  let spool = `${dir}/spool`
  Deno.mkdirSync(spool, { recursive: true })
  let stopped = false
  let watch = Deno.watchFs(spool, { recursive: false })
  let consume = async () => {
    try {
      for await (let e of watch) {
        // Draining the spool must not feed back into the watcher. Empty-spool
        // truncation is separately guarded in turn.ts.
        if (stopped || e.kind == 'access') continue
        if (e.paths.includes(`${spool}/turns.jsonl`)) turns()
      }
    } catch (e) {
      if (!stopped && !(e instanceof Deno.errors.BadResource)) {
        console.warn('vault watch —', e)
      }
    }
  }
  void consume()
  return () => {
    stopped = true
    watch.close()
  }
}
