// File-and-command targets are independent of computer connection and sandbox
// provisioning. A connector only reaches an explicitly selected computer.
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
  /** how often a waiting call looks again (ms, default 100) */
  poll?: number
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
