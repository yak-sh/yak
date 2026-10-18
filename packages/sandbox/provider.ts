// Sandbox lifecycle is independent of computer connections and session defaults.
// A resource id is allocated before provisioning and never reused after disposal.
import type { Workspace } from '@yaks/machine'

/** A durable sandbox locator; address is never a computer connection address. */
export type SandboxRef = { id: string; address?: string }
/** Initial provenance is not a backup of subsequent edits. */
export type SandboxRequest = SandboxRef & { from?: string; image?: string }
/** A connection to the existing sandbox filesystem. Placement is held by the
 * sandbox's workspace row, not inferred from this connection's implementation. */
export type SandboxConnection = {
  workspace: Workspace
  root?: string
  address?: string
}
/** One exported file, read inside the sandbox, not through a host symlink. */
export type SandboxFile = { path: string; bytes: Uint8Array }
/** Configured sandbox lifecycle on an explicit computer (or a backend that
 * cannot disclose placement). connect never creates a replacement resource.
 * request and dispose tolerate repeated calls with the same durable id. */
export type SandboxProvider = {
  request?: (request: SandboxRequest) => Promise<SandboxConnection>
  connect(ref: SandboxRef): Promise<SandboxConnection>
  dispose(ref: SandboxRef): Promise<void>
  export(ref: SandboxRef, paths: string[]): AsyncIterable<SandboxFile>
}

/** Export names are relative and stay inside the sandbox's default directory. */
export let exportPath = (path: string): string => {
  if (
    !path || path.startsWith('/') || path.includes('\0') ||
    path.split('/').some((p) => p == '..' || p == '.')
  ) {
    throw new Error('Sandbox export paths must be relative without . or ..')
  }
  return path
}
