// Provisioning runs only after the durable intention has committed.
import type { Handler, Handlers } from '@yaks/effects'
import { type Comp, token } from '@yaks/graph'
import { sandboxBinding, type SandboxOptions, sandboxRef } from './lifecycle.ts'

/** At-least-once request uses the preallocated identity; adapter request must
 * reconnect an existing resource, and must never replace a destroyed resource. */
export let provisioning =
  ({ providers }: SandboxOptions): Handler =>
  async (event, tx, write, attempt) => {
    let row = (await tx.get([event.entity.eid]))[0]
    if (!row?.sandbox || !row.pending || row.released || row.failed) return
    let sandbox = row.sandbox as Comp
    let workspace = row.workspace as Comp
    let guard = {
      sandbox: {
        provider: token(sandbox.provider),
        address: sandbox.address == null ? null : token(sandbox.address),
        from: sandbox.from == null ? null : token(sandbox.from),
        image: sandbox.image == null ? null : token(sandbox.image),
      },
      workspace: {
        machine: workspace.machine == null ? null : token(workspace.machine),
        root: workspace.root == null ? null : token(workspace.root),
      },
      released: { at: null },
    }
    try {
      let binding = sandboxBinding(row, providers)
      if (!binding.provider.request) {
        throw new Error('Sandbox provider cannot create')
      }
      let connection = await binding.provider.request({
        ...sandboxRef(row),
        ...(sandbox.from ? { from: String(sandbox.from) } : {}),
        ...(sandbox.image ? { image: String(sandbox.image) } : {}),
      })
      let root = connection.root
      if (!root || !root.startsWith('/')) {
        throw new Error('Sandbox provider returned no absolute workspace root')
      }
      // Retry storage without replaying the external request.
      let complete = async () =>
        await write([{
          entity: row.entity,
          $was: guard,
          workspace: { root },
          ...(connection.address
            ? { sandbox: { address: connection.address } }
            : {}),
          pending: null,
          failed: null,
        }])
      if (attempt?.retry) await attempt.retry(complete)
      else await complete()
    } catch (error) {
      if (!attempt || attempt.last()) {
        await write([{
          entity: row.entity,
          $was: guard,
          pending: null,
          failed: { reason: String(error) },
        }])
      }
      throw error
    }
  }

/** Resolve adapters only when an effect runs, after the graph is open. */
export let effects = (
  host: import('./configuration.ts').ConfigurationHost,
  options: import('./configuration.ts').Configuration = {},
): Handlers => ({
  sandbox_provision: async (...args) => {
    let { resolveOptions } = await import('./configuration.ts')
    return await provisioning(await resolveOptions(host, options))(...args)
  },
})
