// Connect existing workspace records through explicitly supplied bindings.
// Sandbox adapters are injected by the host; this package never provisions.
import { Refused } from '@yaks/graph/errors'
import type { Comp, Graph } from '@yaks/graph'
import { computer } from './connectors.ts'
import { executionWorkspace } from './execution.ts'
import type { ComputerConnector, Workspace } from './workspace.ts'
import type { Workspaces } from './targets.ts'

export type WorkspaceBindings = {
  connectors: Record<string, ComputerConnector>
  receipts: string
  sandbox?: (id: string) => Promise<Workspace>
}

/** Unknown placement and unconfigured sandbox backends refuse, never go local. */
export let workspaces = (
  g: Graph,
  bindings: WorkspaceBindings,
): Workspaces => ({
  connect: async (id) => {
    let row = (await g.get([id]))[0]
    let target = row?.workspace as Comp | undefined
    if (!target) throw new Refused('Not a workspace: ' + id)
    if (row?.released) throw new Refused('Workspace has been released: ' + id)
    let sandbox = target.sandbox ?? (row?.sandbox ? id : undefined)
    if (sandbox) {
      if (!bindings.sandbox) throw new Refused('No sandbox workspace binding')
      return await bindings.sandbox(String(sandbox))
    }
    if (!target.machine) {
      throw new Refused('Workspace computer placement is unknown: ' + id)
    }
    let machine = (await g.get([String(target.machine)], ['machine']))[0]
      ?.machine as Comp | undefined
    let transport = await computer(
      machine?.address as string | undefined,
      bindings.connectors,
    )
    if (typeof target.root != 'string') {
      throw new Refused('Workspace root is unknown: ' + id)
    }
    return executionWorkspace(g, transport, {
      workspace: id,
      root: target.root,
      receipts: bindings.receipts,
    })
  },
})
