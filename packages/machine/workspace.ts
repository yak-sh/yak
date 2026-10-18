// File-and-command targets are independent of computer connection and sandbox
// provisioning. A connector only reaches an explicitly selected computer.
import type { Machine } from './mod.ts'

/** Commands and files in one filesystem; durable ids are process entity ids. */
export type Workspace = Machine

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
