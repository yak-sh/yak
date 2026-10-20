// Computers and workspace contracts, independent of provisioning or a runner.

/** A process as the machine holds it: `exit` is absent while it runs, and its
 * code is null when the machine could not learn it. */
export type Proc = { pid?: number; exit?: { code: number | null } }

/** Compatibility name for the shared Workspace interface. */
export type Machine = import('./workspace.ts').Workspace

export * from './comp.ts'

export { settle, shellStat } from './workspace.ts'
export type {
  ComputerConnector,
  ComputerTransport,
  SettleOpts,
  Stat,
  Workspace,
  WorkspaceTarget,
} from './workspace.ts'
