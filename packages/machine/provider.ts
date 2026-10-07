// A provider owns provisioning and attachment, not the graph's machine rows.
// The caller supplies a stable id before the external act, so an interrupted
// request can be retried and wake/release can run in another host process.

import type { Machine } from './mod.ts'

/** A host's configured provider, as data. `use` names its implementation;
 * `with` carries that implementation's options. */
export type ProviderConfig = {
  use: string
  with?: Record<string, unknown>
}

/** A machine the provider can find again without a live handle. An address
 * names an existing machine; absent an address, the id names a sandbox. */
export type MachineRef = { id: string; address?: string }

/** A sandbox to lend. `from` is a commit in the graph, not a host path. */
export type MachineRequest = { id: string; from?: string; image?: string }

/** A machine and its default directory, when the provider has one. */
export type LentMachine = { machine: Machine; cwd?: string }

/** One file shipped out. The caller stores its bytes as a blob or makes a
 * commit; providers do not choose where the graph keeps bytes. */
export type MachineFile = { path: string; bytes: Uint8Array }

/** A provider of machines. A sandbox provider implements `request`; an
 * existing-machine provider implements `attach`; one may implement both.
 * Neither capability is privileged. Hosts choose a sandbox provider by
 * default and use an address only when work explicitly names a machine.
 * Lifecycle operations must tolerate repetition and need no live handle. */
export type MachineProvider = {
  request?: (request: MachineRequest) => Promise<LentMachine>
  attach?: (ref: MachineRef & { address: string }) => Promise<LentMachine>
  wake: (ref: MachineRef) => Promise<LentMachine>
  /** Release a sandbox, or detach an existing machine without destroying it. */
  release: (ref: MachineRef) => Promise<void>
  /** Ship named relative files out, including binary files. */
  export: (ref: MachineRef, paths: string[]) => AsyncIterable<MachineFile>
}
