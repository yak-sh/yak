/** Harness graphs, runners and workspace fixtures that stay in process. */

import { type Runner, running } from '@yaks/session'
import { compose, type Config } from '@yaks/cli/host'
import { install } from '@yaks/connections'
import { type Harness, hosted } from './store.ts'
import { type ComponentType } from 'preact'
import { mount as tui } from '../tui/testing.ts'
import { dress } from './sheet.ts'
import { HARNESS } from './default.ts'

/** The packages a harness graph is made of in these tests: what a transcript
 * is (@yaks/session), what it asks for and what answers (@yaks/tools,
 * @yaks/context, @yaks/model and its providers), what a reply carries
 * (@yaks/blob), the programs it starts (@yaks/process), the sign-ins it keeps
 * (@yaks/secrets, @yaks/connections), the runs its commits owe (@yaks/effects),
 * the work it is doing, and the harness's own words; and which tables each
 * entity is in (@yaks/archetype), so a read asks those tables alone, as the
 * box's own graph does. In a config's order: a
 * later package's computed property wins, so @yaks/session's claim is the step
 * in a task's status it contributes. */
export let PLUGINS: string[] = [
  '@yaks/kernel',
  '@yaks/provenance',
  '@yaks/id',
  '@yaks/key',
  '@yaks/alias',
  '@yaks/secrets',
  '@yaks/edge',
  '@yaks/blob',
  '@yaks/doc',
  '@yaks/archetype',
  '@yaks/effects',
  '@yaks/task',
  '@yaks/project',
  '@yaks/session',
  '@yaks/tools',
  '@yaks/model',
  '@yaks/openai',
  '@yaks/openrouter',
  '@yaks/claude',
  '@yaks/process',
  '@yaks/machine',
  '@yaks/context',
  '@yaks/connections',
  '@yaks/mcp-client',
  '@yaks/git',
  '@yaks/persona',
  '@yaks/topic',
  '@yaks/harness',
  '@yaks/sandbox',
]

/** A config naming the graph at `db` (`:memory:` by default) made of
 * {@link PLUGINS}; `lease` is how long a run it claims stands. */
export let at = (db = ':memory:', lease?: number): Config => ({
  db,
  plugins: PLUGINS,
  ...lease ? { lease } : {},
})

/** That graph, composed and open, as a harness runs over it, with the
 * integrations a process serving its effects installs on the way up (the
 * OpenRouter sign-in goes through one); closing it closes the graph. */
export let harness = async (
  db = ':memory:',
  lease?: number,
): Promise<Harness & { sql: import('@yaks/sql').Statements }> => {
  let host = await compose(at(db, lease), ['graph'], undefined, {})
  let g = host.graph
  await g.apply(await install(g.read), { trusted: true })
  await g.apply([
    { entity: { eid: '$model' }, model: { name: 'gpt-6-astra' } },
    { entity: { eid: '$provider' }, provider: { name: 'openai' } },
    {
      entity: { eid: '$serves' },
      edge: { from: '$provider', to: '$model' },
      serves: { name: 'gpt-6-astra' },
    },
    {
      entity: { eid: HARNESS },
      using: { provider: '$provider', model: '$model' },
    },
  ], { trusted: true })
  let h = { ...hosted(host, () => host.close()), sql: host.storage.statements }
  // Tests of model turns need a durable default intention, not a local provider.
  h.sandboxes = {
    request: async (id) => {
      if (!(await g.get([id]))[0]) {
        await g.apply([{
          entity: { eid: id },
          workspace: {},
          sandbox: { provider: 'fixture' },
          pending: {},
        }])
      }
      return id
    },
  }
  return h
}

/** The runner over `h`, lent `deps`, working its pool as an agent does;
 * `stop()` leaves the pool once what it started has settled. */
export let working = (h: Harness, deps: Omit<Runner, 'holder'>) => {
  let leave = new AbortController()
  h.fx.handle(running(h.g, { holder: h.me, gone: h.gone, ...deps }))
  let work = h.fx.work(h.g, leave.signal)
  return {
    stop: async () => {
      leave.abort()
      await h.fx.stop()
      await work
    },
  }
}

/** A harness view on a fake terminal, dressed as the harness is. */
export let mount = (App: ComponentType, columns?: number, rows?: number) =>
  tui(App, columns, rows, dress)

/** A workspace reading only the fixture's temporary directory, without a shell. */
export let attachedWorkspace = async (h: Pick<Harness, 'g'>, root: string) => {
  let workspace = crypto.randomUUID()
  await h.g.apply([{ entity: { eid: workspace }, workspace: { root } }])
  let inside = (path: string) => path == root || path.startsWith(root + '/')
  let files: import('@yaks/machine').Workspace = {
    start: () => Promise.reject(new Error('Fixture does not start commands')),
    look: () => Promise.resolve(null),
    tail: () => Promise.resolve([]),
    kill: () => Promise.resolve(),
    read: (path) =>
      inside(path)
        ? Deno.readTextFile(path)
        : Promise.reject(new Error('Outside fixture workspace')),
    write: (path, body) =>
      inside(path)
        ? Deno.writeTextFile(path, body)
        : Promise.reject(new Error('Outside fixture workspace')),
    stat: (paths) =>
      Promise.all(paths.map(async (path) => {
        if (!inside(path)) return { kind: 'missing' as const }
        try {
          let info = await Deno.stat(path)
          return {
            kind: info.isDirectory ? 'directory' as const : 'file' as const,
            canonical: await Deno.realPath(path),
          }
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error
          let link = await Deno.lstat(path).catch(() => undefined)
          return {
            kind: link?.isSymlink ? 'dangling' as const : 'missing' as const,
          }
        }
      })),
  }
  return {
    workspace,
    workspaces: { connect: (_workspace: string) => Promise.resolve(files) },
  }
}
