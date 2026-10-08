// The CLI lends providers explicitly. Only this host chooses local directories,
// process environments, and how a graph commit reaches a process sandbox.
import type { Config, Host } from '@yaks/host'
import type { Machine, MachineProvider } from '@yaks/machine'
import { processProvider } from '@yaks/process/machine'
import { sessionEnv } from '@yaks/session'
import { objects } from '@yaks/git'

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
export let machineCapabilities = async (
  host: Host,
  config: Config,
  db: string,
): Promise<NonNullable<Host['machines']>> => {
  let providers: Record<string, MachineProvider> = {}
  let configured = config.machines ?? {
    defaultProvider: 'process',
    providers: { process: { use: '@yaks/process', with: {} } },
  }
  for (let [name, source] of Object.entries(configured.providers)) {
    if (source.use == '@yaks/process') {
      let base = db == ':memory:'
        ? Deno.env.get('TMPDIR') ?? '/tmp'
        : db.slice(0, db.lastIndexOf('/')) || '.'
      let options = source.with ?? {}
      providers[name] = processProvider(host.graph, {
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
      providers[name] = await factory.provider(host, source.with ?? {})
    }
  }
  if (!providers[configured.defaultProvider]?.request) {
    throw new Error('Default machine provider cannot request a sandbox')
  }
  return { providers, defaultProvider: configured.defaultProvider }
}
