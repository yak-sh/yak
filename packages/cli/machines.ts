// The CLI lends providers explicitly. Only this host chooses local directories,
// process environments, and how a graph commit reaches a process sandbox.
import type { Config, Host } from '@yaks/host'
import { given, used } from '@yaks/host/config'
import { derivedEid } from '@yaks/graph/identity'
import type { Machine, MachineProvider } from '@yaks/machine'

let quoted = (word: string) => "'" + word.replaceAll("'", "'\\''") + "'"
let command = async (machine: Machine, text: string, cwd: string) => {
  let id = await machine.start(text, cwd)
  for (;;) {
    let p = await machine.look(id)
    if (!p) throw new Error('Machine preparation lost its process')
    if (p.exit) {
      if (p.exit.code != 0) {
        throw new Error(
          'Machine preparation failed: ' +
            (await machine.tail(id, 40)).join('\n'),
        )
      }
      return
    }
    await new Promise((go) => setTimeout(go, machine.poll ?? 100))
  }
}
/** Configured provider factories are loaded by the host, never by plugins.
 * The process provider is the box's default and does not claim security or
 * resource isolation; an alternative can supply both. */
export let machineCapabilities = (
  host: Host,
  config: Config,
  db: string,
): NonNullable<Host['machines']> => {
  let providers = new Map<string, Promise<MachineProvider>>()
  let configured = config.machines ?? {
    defaultProvider: 'process',
    providers: { process: { use: '@yaks/process', with: {} } },
  }
  if (!Object.hasOwn(configured.providers, configured.defaultProvider)) {
    throw new Error('Default machine provider cannot request a sandbox')
  }
  let load = async (name: string): Promise<MachineProvider> => {
    let source = configured.providers[name]
    let provider: MachineProvider
    if (source.use == '@yaks/process') {
      let [{ processProvider }, { sessionEnv }, { objects }] = await Promise
        .all([
          import('@yaks/process/machine'),
          import('@yaks/session'),
          import('@yaks/git'),
        ])
      let base = db == ':memory:'
        ? Deno.env.get('TMPDIR') ?? '/tmp'
        : db.slice(0, db.lastIndexOf('/')) || '.'
      let options = source.with ?? {}
      provider = processProvider(host.graph, {
        dir: typeof options.dir == 'string' ? options.dir : base + '/machines',
        // How often a command it runs is looked at (ms, the machine's own
        // default unless the config says).
        ...typeof options.poll == 'number'
          ? { processes: { poll: options.poll } }
          : {},
        env: (session) => {
          let environment = Deno.env.toObject()
          return session ? sessionEnv(session, environment) : environment
        },
        prepare: async (from, machine, cwd) => {
          let stream = await objects(host.graph, host.artifacts).pack([from])
          let bytes = new Uint8Array(await new Response(stream).arrayBuffer())
          // Machine has a text-file door. Base64 preserves a binary pack across
          // it; Git consumes exactly the graph's objects, not a host checkout.
          let parts: string[] = []
          for (let i = 0; i < bytes.length; i += 8192) {
            parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
          }
          await machine.write('.machine-pack', btoa(parts.join('')))
          await command(
            machine,
            'git init -q && base64 -d .machine-pack | git unpack-objects -q && git checkout -q --detach ' +
              quoted(from) + ' && rm .machine-pack',
            cwd,
          )
        },
      })
    } else {
      let factory = await import(source.use)
      if (typeof factory.provider != 'function') {
        throw new Error(
          'Machine provider exports no provider factory: ' + source.use,
        )
      }
      provider = await factory.provider(host, source.with ?? {})
    }
    if (name == configured.defaultProvider && !provider?.request) {
      throw new Error('Default machine provider cannot request a sandbox')
    }
    return provider
  }
  return {
    defaultProvider: configured.defaultProvider,
    resolveHome: async (session) => {
      let [owner] = await host.graph.get([session])
      if (!owner?.session || !owner.fixer || !owner.native) return
      let spawn = config.plugins?.find((plug) => used(plug) == '@yaks/spawn')
      let options = spawn ? given(spawn) : {}
      if (typeof options.worktrees != 'string' || !options.worktrees) {
        throw new Error('Native fixer worktrees require @yaks/spawn worktrees')
      }
      // A remote default must never be mistaken for the box running Git.
      let process = Object.entries(configured.providers).find(([, source]) =>
        source.use == '@yaks/process'
      )?.[0]
      if (!process) {
        throw new Error(
          'Native fixer worktrees require a configured process provider',
        )
      }
      let { createWorktree } = await import('@yaks/git/host')
      let tree = await createWorktree(
        host.graph,
        typeof options.cwd == 'string' ? options.cwd : Deno.cwd(),
        {
          path: `${options.worktrees}/${session}`,
          branch: `session-${session}`,
        },
      )
      let cwd = String((tree.worktree as { path: string }).path)
      let machine = derivedEid('native-fixer-machine|' + session)
      let [existing] = await host.graph.get([machine])
      if (!existing?.machine) {
        await host.graph.apply([{
          entity: { eid: machine },
          // An attachment is never ours to remove or stop on release.
          machine: { provider: process, address: cwd, state: 'running' },
        }])
      }
      return { machine, cwd }
    },
    provider: (name) => {
      if (!Object.hasOwn(configured.providers, name)) {
        return Promise.resolve(undefined)
      }
      let loading = providers.get(name)
      if (!loading) providers.set(name, loading = load(name))
      return loading
    },
  }
}
