// Where a process stands: the /proc ancestor walk. A hook or an MCP stdio
// server runs under a shell under `claude` (verified live: deno → zsh →
// claude), but the depth is nobody's contract — so the walk climbs comm by
// comm to the nearest matching ancestor. Linux-only by nature; anywhere
// /proc is missing (or unreadable) every lookup resolves to undefined and
// callers fall back to their env hints. Deno gates /proc behind FULL trust:
// even an unscoped --allow-read gets NotCapable ("requires all access",
// proven live) — a caller that wants the walk must run with --allow-all.

let read = (p: string) => {
  try {
    return Deno.readTextFileSync(p)
  } catch {
    return ''
  }
}

// The parent pid is field 4 of /proc/<pid>/stat, after the parenthesized
// comm — split after the LAST ')' so a comm containing ')' can't shift it.
export let parentOf = (pid: number): number | undefined => {
  let stat = read(`/proc/${pid}/stat`)
  if (!stat) return
  let n = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
  return n > 0 ? n : undefined
}

export let commOf = (pid: number) => read(`/proc/${pid}/comm`).trim()

// The argv a pid was launched with — cmdline is NUL-separated with a
// trailing NUL, which would otherwise read as one empty final arg.
export let argsOf = (pid: number) =>
  read(`/proc/${pid}/cmdline`).split('\0').filter((a) => a != '')

// The nearest ancestor (self included) with this comm, or undefined when
// the walk tops out at init.
export let ancestor = (comm: string, pid = Deno.pid): number | undefined => {
  for (let p: number | undefined = pid; p; p = parentOf(p)) {
    if (commOf(p) == comm) return p
  }
}

// The provider process this hook runs under. Claude's channel also binds to
// this pid; Codex uses it only to keep its external transcript followed.
export let agentPid = (provider: string) => ancestor(provider)
export let claudePid = () => agentPid('claude')
