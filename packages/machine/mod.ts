// Commands and files through one Machine contract. Providers lend sandboxes
// or attach existing machines; neither the caller nor this module assumes
// that a machine runs beside the graph.

/** A process as the machine holds it: `exit` is absent while it runs, and its
 * code is null when the machine could not learn it. */
export type Proc = { pid?: number; exit?: { code: number | null } }

/** Commands and files on a machine, independent of the host and runtime. */
export type Machine = {
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

export * from './provider.ts'
export * from './comp.ts'
