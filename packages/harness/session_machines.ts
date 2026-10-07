// Sessions name machines in the graph; only configured providers know how to
// reach them. A record precedes provisioning, so another worker can resume an
// interrupted request without inventing a second sandbox.
import { type Bundle, type Comp, derivedEid, type Graph } from '@yaks/graph'
import type {
  Machine,
  MachineFile,
  MachineProvider,
  MachineRef,
} from '@yaks/machine'
import type { ChildLimits } from '@yaks/session'
import { type Snapshot, snapshot } from '@yaks/context'
import { owed } from '@yaks/persona'
import { isAbsolute, relative, resolve } from '@std/path/posix'

export type Machines = {
  providers: Record<string, MachineProvider>
  defaultProvider: string
  /** Host-boundary translation for sessions written by a previous host.
   * The harness never reads that host's stored representation. */
  resolveHome?: (session: string) => Promise<Comp | undefined>
}
let row = async (g: Graph, eid: string) => (await g.get([eid]))[0]
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** An explicit home is data, never a path on the host's own filesystem. */
export let homeAt = (machine?: string, cwd?: string): Comp => ({
  ...machine ? { machine } : {},
  ...cwd ? { cwd } : {},
})

/** The stored command directory. A provider's default is obtained through the
 * binding's `cwd`, not by assuming that the host and session share a disk. */
export let sessionCwd = async (
  g: Graph,
  session: string,
  fallback?: string,
): Promise<string | undefined> => {
  let home = comp(await row(g, session), 'home')
  return home?.cwd == null ? fallback : String(home.cwd)
}

/** The persona owed beside instruction files already read from the machine. */
export let owing = async (
  g: Graph,
  home: Comp,
  files: Snapshot[],
  persona?: string,
): Promise<Snapshot[]> => {
  if (!home.cwd && !persona) return []
  let owes = await owed(g, String(home.cwd ?? ''), files.map((f) => f.body), {
    persona,
  })
  return owes ? [await snapshot(owes.text, owes.source)] : []
}

let own = (session: string) => derivedEid('session-machine|' + session)
let queues = new WeakMap<Graph, Map<string, Promise<unknown>>>()
let serial = <T>(g: Graph, key: string, go: () => Promise<T>): Promise<T> => {
  let queue = queues.get(g)
  if (!queue) queues.set(g, queue = new Map())
  let next = (queue.get(key) ?? Promise.resolve()).catch(() => {}).then(go)
  queue.set(key, next)
  return next.finally(() => {
    if (queue!.get(key) == next) queue!.delete(key)
  })
}
let refOf = (id: string, record: Comp): MachineRef => ({
  id,
  ...record.address != null ? { address: String(record.address) } : {},
})
let string = (value: unknown, name: string): string | undefined => {
  if (value == null) return
  if (typeof value != 'string' || !value) {
    throw new Error(name + ' must be a nonempty string')
  }
  return value
}

/** Bind a graph to its host's configured providers. Nothing is provisioned
 * until a caller asks for `machine` or `cwd`; children only record intentions. */
export let machines = (g: Graph, configured?: Machines): SessionMachines => {
  let provider = (name: string): MachineProvider => {
    let found = configured?.providers[name]
    if (!found) throw new Error('Machine provider is not configured: ' + name)
    return found
  }
  let defaults = () => {
    let name = configured?.defaultProvider
    if (!name) throw new Error('This host lends no default machine provider')
    provider(name)
    return name
  }
  let requested = async (
    session: string,
    request: Record<string, unknown> = {},
  ): Promise<string> => {
    let name = string(request.provider, 'machine.provider') ?? defaults()
    if (!provider(name).request) {
      throw new Error('Machine provider cannot request a sandbox: ' + name)
    }
    let id = own(session)
    let existing = await row(g, id)
    if (!existing?.machine) {
      await g.apply([{
        entity: { eid: id },
        machine: {
          provider: name,
          ...request.from != null
            ? { from: string(request.from, 'machine.from') }
            : {},
          ...request.image != null
            ? { image: string(request.image, 'machine.image') }
            : {},
          state: 'requested',
        },
      }])
    }
    return id
  }
  let home = async (session: string): Promise<Comp> => {
    let owner = await row(g, session)
    if (!owner?.session) throw new Error('not a session: ' + session)
    let at = comp(owner, 'home') ?? {}
    if (at.machine) return at
    let translated = await configured?.resolveHome?.(session)
    if (translated?.machine) {
      await g.apply([{ entity: owner.entity, home: translated }])
      return { ...at, ...translated }
    }
    let id = await requested(session)
    await g.apply([{ entity: owner.entity, home: { machine: id } }])
    return { ...at, machine: id }
  }
  let lent = async (session: string) => {
    let at = await serial(g, session, () => home(session))
    let id = String(at.machine)
    return serial(g, id, async () => {
      let record = comp(await row(g, id), 'machine')
      if (!record) throw new Error('not a machine entity: ' + id)
      let source = provider(String(record.provider))
      let ref = refOf(id, record)
      let loan = record.state == 'requested' || record.state == 'released'
        ? ref.address != null
          ? await source.attach?.({ ...ref, address: ref.address })
          : await source.request?.({
            id,
            ...record.from != null ? { from: String(record.from) } : {},
            ...record.image != null ? { image: String(record.image) } : {},
          })
        : await source.wake(ref)
      if (!loan) throw new Error('Provider cannot lend machine: ' + id)
      let patches: Bundle[] = []
      if (record.state != 'running') {
        patches.push({ entity: { eid: id }, machine: { state: 'running' } })
      }
      let directory = await sessionCwd(g, session)
      if (!directory && loan.cwd) {
        patches.push({ entity: { eid: session }, home: { cwd: loan.cwd } })
      }
      if (patches.length) await g.apply(patches)
      return { ...loan, root: loan.cwd, cwd: directory ?? loan.cwd }
    })
  }
  let release = async (session: string) => {
    let at = comp(await row(g, session), 'home')
    if (!at?.machine) return
    let id = String(at.machine)
    await serial(g, id, async () => {
      // A fork sharing its parent's machine does not own that machine's end.
      // Even an owned machine may still be lent to another live session.
      let others = await g.read(`.home.machine=${id} .session *`)
      for (let other of others) {
        if (other.entity.eid != session && !await machineDone(g, other)) return
      }
      let record = comp(await row(g, id), 'machine')
      if (!record || record.state == 'released') return
      await provider(String(record.provider)).release(refOf(id, record))
      await g.apply([{ entity: { eid: id }, machine: { state: 'released' } }])
    })
  }
  let limits: ChildLimits = {
    taskDefaults: async (parent) => {
      let at = await serial(g, parent, () => home(parent))
      let record = at.machine
        ? comp(await row(g, String(at.machine)), 'machine')
        : undefined
      return {
        machine: {
          provider: defaults(),
          ...record?.from != null ? { from: record.from } : {},
        },
      }
    },
    childProperties: {
      machine: {
        description:
          'Existing machine entity id, or a new sandbox request. Omit to share the parent machine.',
        oneOf: [{ type: 'string' }, {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            from: {
              type: 'string',
              description: 'Commit entity in the graph.',
            },
            image: { type: 'string' },
          },
          additionalProperties: false,
        }],
      },
      cwd: {
        type: 'string',
        description:
          'Command directory on the machine. Relative paths resolve from the parent command directory.',
      },
    },
    prepareChild: async ({ parent, child, args }) => {
      let inherited = args.machine == null
        ? await serial(g, parent, () => home(parent))
        : comp(await row(g, parent), 'home') ?? {}
      let at: Comp = { ...inherited }
      if (args.machine != null) {
        if (typeof args.machine == 'string') {
          if (!(await row(g, args.machine))?.machine) {
            throw new Error('not a machine entity: ' + args.machine)
          }
          at = { machine: args.machine }
        } else if (
          typeof args.machine == 'object' && !Array.isArray(args.machine)
        ) {
          at = {
            machine: await requested(
              child,
              args.machine as Record<string, unknown>,
            ),
          }
        } else {throw new Error(
            'machine must be an entity id or sandbox request',
          )}
      }
      if (args.cwd != null) {
        let cwd = string(args.cwd, 'cwd')!
        let base = inherited.cwd == null ? undefined : String(inherited.cwd)
        if (!cwd.startsWith('/') && !base?.startsWith('/')) {
          throw new Error('Relative cwd requires a parent command directory')
        }
        at.cwd = cwd.startsWith('/') ? resolve(cwd) : resolve(base!, cwd)
      }
      return { home: at } as Omit<Bundle, 'entity'>
    },
  }
  return {
    machine: async (session: string): Promise<Machine> =>
      (await lent(session)).machine,
    cwd: async (session: string): Promise<string | undefined> =>
      (await lent(session)).cwd,
    homeAt,
    release,
    files: async function* (
      session: string,
      paths: string[],
    ): AsyncIterable<MachineFile> {
      let loan = await lent(session)
      let selected = paths.map((path) => {
        let target = isAbsolute(path)
          ? resolve(path)
          : loan.cwd
          ? resolve(loan.cwd, path)
          : path
        if (!loan.root) {
          if (isAbsolute(target) || target.split('/').includes('..')) {
            throw new Error('Machine file export needs a provider root')
          }
          return target
        }
        let scoped = relative(loan.root, target)
        if (scoped == '..' || scoped.startsWith('../') || isAbsolute(scoped)) {
          throw new Error('Machine file is outside its export root: ' + path)
        }
        return scoped
      })
      let at = comp(await row(g, session), 'home')!
      let id = String(at.machine)
      let record = comp(await row(g, id), 'machine')!
      yield* provider(String(record.provider)).export(
        refOf(id, record),
        selected,
      )
    },
    limits,
  }
}
export type SessionMachines = {
  machine: (session: string) => Promise<Machine>
  cwd: (session: string) => Promise<string | undefined>
  homeAt: typeof homeAt
  release: (session: string) => Promise<void>
  files: (session: string, paths: string[]) => AsyncIterable<MachineFile>
  limits: ChildLimits
}

/** Settling a turn is not permission to destroy its edits. A completed task
 * can release its machine once its session has stopped asking for work. */
export let machineDone = async (
  g: Graph,
  session: Bundle,
): Promise<boolean> => {
  let record = comp(session, 'session')
  if (!record || (session.process && !session.exit)) return false
  if (session.completed || record.ended || record.status == 'stopped') {
    return true
  }
  if (!['settled', 'failed'].includes(String(record.status))) return false
  if (!g.vocab.comps.includes('task')) return false
  let tasks = await g.read(`.task&.claim.session=${session.entity.eid}&*`)
  return tasks.length > 0 &&
    tasks.every((task) => task.completed || task.cancelled)
}
