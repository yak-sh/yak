// Never watch the vault root: it contains SQLite's db, WAL and SHM. Only the
// theme file and the dedicated hook spool may wake these consumers (T-35631).
export let watchVault = (
  dir: string,
  theme: () => void,
  turns: () => void,
  pollMs = 1000,
) => {
  let css = `${dir}/theme.css`
  let spool = `${dir}/spool`
  Deno.mkdirSync(spool, { recursive: true })
  let stopped = false
  let consume = async (w: Deno.FsWatcher, act: (e: Deno.FsEvent) => void) => {
    try {
      for await (let e of w) {
        // Reading the theme or draining the spool must not feed back into the
        // watcher. Empty-spool truncation is separately guarded in turn.ts.
        if (!stopped && e.kind != 'access') act(e)
      }
    } catch (e) {
      if (!stopped && !(e instanceof Deno.errors.BadResource)) {
        console.warn('vault watch —', e)
      }
    }
  }
  let spoolWatch = Deno.watchFs(spool, { recursive: false })
  void consume(spoolWatch, (e) => {
    if (e.paths.includes(`${spool}/turns.jsonl`)) turns()
  })

  // A file watch follows an inode, not its name. Probe only theme.css to
  // discover a first creation, deletion or an editor's atomic replacement,
  // then reattach. No placeholder file and no parent-directory watch needed.
  let themeWatch: Deno.FsWatcher | undefined
  let seen: string | undefined
  let probe = () => {
    let next = ''
    try {
      let s = Deno.statSync(css)
      next =
        `${s.dev}:${s.ino}:${s.mtime?.getTime()}:${s.ctime?.getTime()}:${s.size}`
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) return
    }
    if (next == seen) return
    let initial = seen === undefined
    seen = next
    themeWatch?.close()
    themeWatch = undefined
    if (next) {
      try {
        themeWatch = Deno.watchFs(css, { recursive: false })
        void consume(themeWatch, () => theme())
      } catch {
        seen = undefined // raced a removal; retry without ever watching dir
      }
    }
    if (!initial) theme()
  }
  probe()
  let timer = setInterval(probe, pollMs)
  return () => {
    stopped = true
    clearInterval(timer)
    themeWatch?.close()
    themeWatch = undefined
    spoolWatch.close()
  }
}
