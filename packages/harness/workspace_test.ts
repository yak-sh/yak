// Local root sessions observe their checkout once; remote graph-only openings
// and explicit target overrides do not borrow the graph host's directory.
import { equal, ok, test } from '@yaks/testing'
import { homeAt } from './workspace.ts'
import { tools as cliTools } from './cli.ts'
import { cli } from '@yaks/cli'
import { commands as localCommands } from '../cli/subcommands.ts'
import { close as closeCli } from '../cli/local.ts'
import { runs } from './runs.ts'
import { here } from './local.ts'
import { hosted } from './store.ts'
import { at } from './testing.ts'
import { compose } from '@yaks/cli/host'
import type { Comp } from '@yaks/graph'

let dir = await Deno.makeTempDir(),
  root = dir + '/checkout',
  sub = root + '/nested',
  outside = dir + '/outside'
await Deno.mkdir(sub, { recursive: true })
await Deno.mkdir(outside)
let run = async (...args: string[]) => {
  let p = await new Deno.Command('git', {
    args,
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!p.success) throw Error(new TextDecoder().decode(p.stderr))
}
await run('init', '-q', '-b', 'main')
await run('config', 'user.email', 'test@example.org')
await run('config', 'user.name', 'Test')
await Deno.writeTextFile(root + '/file', 'retained edits')
await run('add', '.')
await run('commit', '-qm', 'initial')
let config = dir + '/yak.json'
await Deno.writeTextFile(
  config,
  JSON.stringify({ ...at(dir + '/graph.db'), duties: false }),
)
let output: string[] = [], exitCode: number | undefined
let prior = Deno.cwd(),
  args: Record<string, unknown> = { tui: true, model: 'fixture' },
  explicit = { workspace: 'explicit', cwd: '/elsewhere' }
try {
  Deno.chdir(sub)
  await cliTools.session_new(args, { config, duties: false })
  await cliTools.session_new(explicit, { config, duties: false })
  exitCode = await cli([], {
    argv: [
      '--config',
      config,
      '--no-duties',
      '--json',
      '--tui',
      'session',
      'new',
      '--model',
      'fixture',
    ],
    more: localCommands,
    out: (s) => output.push(s),
  })
  await closeCli()
} finally {
  Deno.chdir(prior)
}
let host = await compose(
  { ...at(dir + '/graph.db'), duties: false },
  ['graph'],
  undefined,
  { process: false },
)
let home = await homeAt(host.graph, sub),
  again = await homeAt(host.graph, sub),
  none = await homeAt(host.graph, outside)
let tree = (await host.graph.get([String(home.workspace)]))[0]
let [opened] = await runs(host).session_new!({
  entity: { eid: crypto.randomUUID() },
  call: { args },
}, host.graph)
let [remote] = await runs(host).session_new!({
  entity: { eid: crypto.randomUUID() },
  call: { args: { tui: true, model: 'fixture' } },
}, host.graph)
let lent = here(hosted(host), { cwd: sub })
let localOpening = await lent.lent.opening!()
await lent.lent.release?.()
let started = opened.home as Comp
let commandRows = JSON.parse(output.at(-1)!)
let commandHome = commandRows.result[0].home
await host.close()
await Deno.remove(dir, { recursive: true })

test('local session new defaults to the launch checkout root and nested command directory', () => {
  equal(args, {
    tui: true,
    model: 'fixture',
    workspace: home.workspace,
    cwd: sub,
  })
  equal(started, { workspace: home.workspace, cwd: sub })
  equal(exitCode, 0)
  equal(commandHome, started)
  equal(localOpening.home, started)
  equal((tree.workspace as Comp).root, root)
  ok((tree.workspace as Comp).machine)
  ok(tree.worktree)
  equal(again, home)
})
test('explicit workspace selection is not replaced by the launch checkout', () => {
  equal(explicit, { workspace: 'explicit', cwd: '/elsewhere' })
})
test('non-checkout and graph-only openings do not infer the server filesystem', () => {
  equal(none, {})
  equal(remote.home, {})
})
