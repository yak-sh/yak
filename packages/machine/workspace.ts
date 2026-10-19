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
  /** replaces what the path held, making its directory where it has none */
  write(path: string, content: string): Promise<void>
  /** how soon a waiting call first looks again (ms, default 100); later
   * looks come further apart, see `settle` */
  poll?: number
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
}

/** A configured connector reaches an existing computer, never provisions it. */
export type ComputerConnector = {
  connect(address: string): Promise<ComputerTransport>
}

/** Quote one value for the POSIX shell. */
export let quote = (value: string): string =>
  "'" + value.replaceAll("'", "'\\''") + "'"
