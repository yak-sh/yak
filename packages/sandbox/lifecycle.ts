// Durable sandbox intentions and operations, independent of adapter SDKs.
import { type Bundle, type Comp, type Graph, mint, token } from '@yaks/graph'
import type {
  SandboxConnection,
  SandboxFile,
  SandboxProvider,
  SandboxRef,
} from './provider.ts'
import { exportPath } from './provider.ts'

/** A configured adapter and its explicit computer; omitted only for backends
 * which cannot disclose placement. Never inferred from the executing host. */
export type SandboxBinding = { provider: SandboxProvider; machine?: string }
export type SandboxBindings = Record<string, SandboxBinding>
export type SandboxOptions = { providers: SandboxBindings }
export type SandboxNew = {
  id?: string
  machine?: string
  provider: string
  from?: string
  image?: string
}
let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

/** Resolve only the recorded placement, never a local fallback. */
export let sandboxBinding = (
  row: Bundle,
  bindings: SandboxBindings,
): SandboxBinding => {
  let name = String(comp(row, 'sandbox').provider ?? '')
  let binding = bindings[name]
  if (!binding) throw new Error(`Sandbox provider is not configured: ${name}`)
  let machine = comp(row, 'workspace').machine
  if (machine !== binding.machine) {
    throw new Error(
      `Sandbox provider ${name} does not serve the recorded computer`,
    )
  }
  return binding
}
export let sandboxRef = (row: Bundle): SandboxRef => ({
  id: row.entity.eid,
  ...(comp(row, 'sandbox').address
    ? { address: String(comp(row, 'sandbox').address) }
    : {}),
})
export let sandboxRow = async (
  graph: Pick<Graph, 'get'>,
  id: string,
): Promise<Bundle> => {
  let row = (await graph.get([id]))[0]
  if (!row?.sandbox || !row.workspace) {
    throw new Error(`No sandbox workspace: ${id}`)
  }
  return row
}

/** Persist this intention before provisioning. A caller may supply its durable
 * call-derived id, making a repeated request name the same resource. */
export let sandboxNew = async (
  graph: Pick<Graph, 'get' | 'apply'>,
  bindings: SandboxBindings,
  request: SandboxNew,
): Promise<Bundle> => {
  let id = request.id ?? mint()
  let existing = (await graph.get([id]))[0]
  if (existing) {
    if (!existing.sandbox || existing.released) {
      throw new Error(`Sandbox id cannot be reused: ${id}`)
    }
    let stored = comp(existing, 'sandbox')
    if (
      stored.provider !== request.provider ||
      comp(existing, 'workspace').machine !== request.machine ||
      stored.from !== request.from || stored.image !== request.image
    ) {
      throw new Error(`Sandbox request changed: ${id}`)
    }
    sandboxBinding(existing, bindings)
    if (existing.failed) throw new Error(`Sandbox request failed: ${id}`)
    return existing
  }
  let row: Bundle = {
    entity: { eid: id },
    sandbox: {
      provider: request.provider,
      ...(request.from ? { from: request.from } : {}),
      ...(request.image ? { image: request.image } : {}),
    },
    workspace: {
      ...(request.machine ? { machine: request.machine } : {}),
    },
    pending: {},
  }
  let binding = sandboxBinding(row, bindings)
  if (!binding.provider.request) {
    throw new Error(`Sandbox provider cannot create: ${request.provider}`)
  }
  if (request.machine && !(await graph.get([request.machine]))[0]?.machine) {
    throw new Error(`No computer: ${request.machine}`)
  }
  await graph.apply([{ ...row, $was: { sandbox: { provider: null } } }])
  return row
}

/** Reconnect is never create. Pending, failed and released rows are not usable. */
export let sandboxConnect = async (
  graph: Pick<Graph, 'get'>,
  bindings: SandboxBindings,
  id: string,
): Promise<SandboxConnection> => {
  let row = await sandboxRow(graph, id)
  if (row.released || row.pending || row.failed) {
    throw new Error(`Sandbox is not ready: ${id}`)
  }
  let connection = await sandboxBinding(row, bindings).provider.connect(
    sandboxRef(row),
  )
  if (connection.root !== comp(row, 'workspace').root) {
    throw new Error(`Sandbox workspace root changed: ${id}`)
  }
  return connection
}

/** Called from a durable tool invocation. A release is recorded only after the
 * provider confirms disposal; repeated disposal never requests a new resource. */
export let sandboxDispose = async (
  graph: Pick<Graph, 'get' | 'apply'>,
  bindings: SandboxBindings,
  id: string,
): Promise<Bundle> => {
  let row = await sandboxRow(graph, id)
  if (row.released) return row
  if (row.pending) {
    throw new Error(`Sandbox provisioning is still pending: ${id}`)
  }
  await sandboxBinding(row, bindings).provider.dispose(sandboxRef(row))
  let released: Bundle = {
    entity: row.entity,
    $was: {
      sandbox: {
        provider: token(comp(row, 'sandbox').provider),
        address: comp(row, 'sandbox').address == null
          ? null
          : token(comp(row, 'sandbox').address),
      },
      workspace: {
        machine: comp(row, 'workspace').machine == null
          ? null
          : token(comp(row, 'workspace').machine),
      },
    },
    released: {},
    pending: null,
    failed: null,
  }
  await graph.apply([released])
  return released
}

/** Export only from an existing ready resource; relative paths are validated
 * before an adapter is asked to read files. Bytes remain inside the caller's
 * explicit export channel, never read through the host filesystem. */
export async function* sandboxExport(
  graph: Pick<Graph, 'get'>,
  bindings: SandboxBindings,
  id: string,
  paths: string[],
): AsyncIterable<SandboxFile> {
  let selected = paths.map(exportPath)
  let row = await sandboxRow(graph, id)
  if (row.released || row.pending || row.failed) {
    throw new Error(`Sandbox is not ready: ${id}`)
  }
  yield* sandboxBinding(row, bindings).provider.export(
    sandboxRef(row),
    selected,
  )
}
