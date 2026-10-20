// File-and-command targets are independent of computer connection and sandbox
// provisioning. A connector only reaches an explicitly selected computer.
import { sleep as nap } from '@yaks/fp'
import type { Proc } from './mod.ts'

/** Commands and files in one filesystem; durable ids are process entity ids. */
export type Workspace = {
  /** starts a command line, run by bash, and answers its id */
  start(
    command: string,
    cwd?: string,
    call?: string,
    session?: string,
  ): Promise<string>
  /** the process a durable call started, where this machine can recover one */
  receipt?: (call: string) => Promise<string | undefined>
  /** the process by that id, or null when the machine has none */
  look(id: string): Promise<Proc | null>
  /** the last `n` lines it printed */
  tail(id: string, n: number): Promise<string[]>
  /** asks it to end */
  kill(id: string, signal: 'SIGTERM' | 'SIGKILL'): Promise<void>
  read(path: string): Promise<string>
  /** what each path names, its links followed, in the order asked; a read,
   * answered without starting a command */
  stat(paths: string[]): Promise<Stat[]>
  /** replaces what the path held, making its directory where it has none */
  write(path: string, content: string): Promise<void>
  /** how soon a waiting call first looks again (ms, default 100); later
   * looks come further apart, see `settle` */
  poll?: number
}

/** What a path names once its links are followed, and its canonical path
 * (every link resolved) wherever it names something: `dangling` is a link to
 * nothing, and `missing` is no entry at all, or one this user cannot reach. */
export type Stat =
  | { kind: 'missing' | 'dangling' }
  | { kind: 'file' | 'directory' | 'other'; canonical: string }

/** UTF-8 text from base64, whitespace and all. */
export let decode = (text: string): string =>
  new TextDecoder().decode(
    Uint8Array.from(atob(text.replaceAll(/\s/g, '')), (c) => c.charCodeAt(0)),
  )

// One shell for every path, and no forks but for a link: `cd -P` resolves a
// directory's links, as `pwd -P` says, and `realpath` runs only for a path
// whose last part is itself a link. A line each: the kind, then the canonical
// path with `%` and newline escaped as a URI would.
let statScript = (paths: string[]) =>
  `here=$PWD
for f in ${paths.map(quote).join(' ')}; do
k=missing c=
if test -e "$f"; then
if test -f "$f"; then k=file; elif test -d "$f"; then k=directory; else k=other; fi
if test -L "$f"; then c=$(realpath -e -- "$f")
elif test $k = directory; then cd -P -- "$f" 2>/dev/null && c=$PWD
else case $f in */*) d=\${f%/*};; *) d=.;; esac
cd -P -- "\${d:-/}" 2>/dev/null && c=\${PWD%/}/\${f##*/}; fi
test -n "$c" || c=$(realpath -e -- "$f")
cd -- "$here"; c=\${c//%/%25}; c=\${c//$'\\n'/%0A}
elif test -L "$f"; then k=dangling; fi
printf '%s %s\\n' "$k" "$c"
done`

/** `stat` for a computer that runs bash scripts, all the paths in one. */
export let shellStat =
  (execute: (script: string) => Promise<string>) =>
  async (paths: string[]): Promise<Stat[]> => {
    if (!paths.length) return []
    let lines = (await execute(statScript(paths))).replace(/\n$/, '')
      .split('\n')
    if (lines.length != paths.length) {
      throw new Error('Invalid workspace stat response')
    }
    return lines.map((line): Stat => {
      let at = line.indexOf(' ')
      let kind = line.slice(0, at), canonical = line.slice(at + 1)
      if (kind == 'missing' || kind == 'dangling') return { kind }
      if (
        (kind == 'file' || kind == 'directory' || kind == 'other') && canonical
      ) return { kind, canonical: decodeURIComponent(canonical) }
      throw new Error('Invalid workspace stat response')
    })
  }

/** How long `settle` waits and what it tells time by; a test gives a virtual
 * clock. */
export type SettleOpts = {
  /** the longest to wait (ms, default no limit) */
  ms?: number
  /** ends the wait, never the command */
  signal?: AbortSignal
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** The process once it has ended, `ms` has passed or `signal` aborted,
 * whichever is first; null for an id the machine does not know. Like checking
 * a kettle, it looks often at first and then less: the first gap is the
 * machine's `poll`, each next one half again as long, up to two seconds. A
 * short command answers within a fraction of a second; a long wait costs a
 * look every two seconds. */
export let settle = async (
  m: Pick<Workspace, 'look' | 'poll'>,
  id: string,
  { ms = Infinity, signal, now = Date.now, sleep = nap }: SettleOpts = {},
): Promise<Proc | null> => {
  let end = now() + ms, gap = m.poll ?? 100
  for (;;) {
    let p = await m.look(id)
    if (!p || p.exit || signal?.aborted || now() >= end) return p
    await sleep(Math.max(0, Math.min(gap, end - now())), signal)
    gap = Math.max(gap, Math.min(gap * 1.5, 2000))
  }
}

/** A concrete, immutable launch target. Paths are in the target filesystem. */
export type WorkspaceTarget = {
  workspace: string
  root: string
  /** Absolute directory for receipts on the original filesystem. */
  receipts: string
}

/** A computer transport executes a short control script, not a managed run.
 * Failure must propagate; a remote failure never selects the local transport. */
export type ComputerTransport = {
  execute(script: string): Promise<string>
  /** how soon a wait on a process here first looks again (ms, default 100):
   * a look is one control script, a local shell or a network round trip */
  poll?: number
}

/** A configured connector reaches an existing computer, never provisions it. */
export type ComputerConnector = {
  connect(address: string): Promise<ComputerTransport>
}

/** Quote one value for the POSIX shell. */
export let quote = (value: string): string =>
  "'" + value.replaceAll("'", "'\\''") + "'"
