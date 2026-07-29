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

// Where a process is standing. The kernel appends ' (deleted)' when the
// directory has been removed under it — a marker worth keeping, since a
// process working in a directory nobody can reach is finished by definition.
export let cwdOf = (pid: number) => {
  try {
    return Deno.readLinkSync(`/proc/${pid}/cwd`)
  } catch {
    return ''
  }
}

// One variable out of a process's launch environment. environ is a frozen
// copy of exec time, which is what makes it evidence: a child carries the
// session id of whoever spawned it long after that session is gone.
export let envOf = (pid: number, name: string) => {
  for (let pair of read(`/proc/${pid}/environ`).split('\0')) {
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1)
  }
}

// When a process started, and who owns it: /proc/<pid>'s own inode carries
// both, so one stat answers age and ownership without parsing clock ticks.
export let bornAt = (pid: number) => {
  try {
    return Deno.statSync(`/proc/${pid}`).mtime?.getTime()
  } catch {
    return undefined
  }
}

export let ownerOf = (pid: number) => {
  try {
    return Deno.statSync(`/proc/${pid}`).uid ?? undefined
  } catch {
    return undefined
  }
}

// Every process on the box, by pid. /proc's numeric entries ARE the roster;
// anything that dies between the listing and the read simply reads empty.
export let pids = (): number[] => {
  try {
    return [...Deno.readDirSync('/proc')]
      .map((e) => Number(e.name))
      .filter((n) => n > 0)
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

// The nearest ancestor (self included) with this comm, or undefined when
// the walk tops out at init.
export let ancestor = (comm: string, pid = Deno.pid): number | undefined => {
  for (let p: number | undefined = pid; p; p = parentOf(p)) {
    if (commOf(p) == comm) return p
  }
}

// A launcher marker scopes an inherited capability to its one process tree.
// Provider shims may sit between the launcher and agent, so direct parenthood
// is too narrow; walking to the named root still excludes sibling launches.
export let descends = (
  pid: number,
  root: number,
  parent = parentOf,
): boolean => {
  for (let p: number | undefined = pid; p; p = parent(p)) {
    if (p == root) return true
  }
  return false
}

// Every pid from here up to init. A reaper's blind spot on purpose: it must
// never be able to kill the process it is running in, or its shell.
export let lineage = (pid = Deno.pid): number[] => {
  let out: number[] = []
  for (let p: number | undefined = pid; p; p = parentOf(p)) out.push(p)
  return out
}

// The provider process this hook runs under. Claude's channel also binds to
// this pid; Codex uses it only to keep its external transcript followed.
export let agentPid = (provider: string) => ancestor(provider)
export let claudePid = () => agentPid('claude')
