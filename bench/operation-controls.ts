/** Safe retained-builder and CLI control waits. No model is run, no upstream
 * exists in land's independent repository, and no managed process is signalled. */
import type { Operation } from './operation-commands.ts'
import type { OperationContext } from './operation-local.ts'
import { toolEid } from '@yaks/tools'
import { measureControls } from './operation-commands.ts'
export let CONTROL_FAMILIES = [
  'builder-choose',
  'builder-supply',
  'builder-plan',
  'session-cache',
  'session-listen',
  'trace-arm',
  'init',
  'land',
]
export let CONTROL_NAMES = CONTROL_FAMILIES.flatMap((family) =>
  (family.startsWith('builder-') ? ['cli', 'connector'] : ['cli']).map((door) =>
    `${door}/${family}`
  )
)
export let controlOperations = async (
  c: OperationContext,
): Promise<Operation[]> => {
  let { graph, dir, PERSON, TARGET, SESSION, fresh, saved, includes } = c
  let builder = crypto.randomUUID(),
    build = crypto.randomUUID(),
    a = crypto.randomUUID(),
    b = crypto.randomUUID(),
    artifact = crypto.randomUUID()
  await graph.apply([
    {
      entity: { eid: toolEid('memory_source') },
      tool: { name: 'memory_source' },
    },
    {
      entity: { eid: builder },
      builder: {
        query: `$input .entity.eid=${TARGET}`,
        to: toolEid('memory_source'),
      },
      staged: {},
      content: { body: 'A local planning benchmark, no execution' },
    },
    {
      entity: { eid: build },
      build: { builder, match: JSON.stringify([TARGET]), variant: 'main' },
    },
    {
      entity: { eid: a },
      built: { build, slot: 'retained' },
      doc: { title: 'Older retained take' },
      chosen: {},
    },
    {
      entity: { eid: b },
      built: { build, slot: 'retained' },
      doc: { title: 'Selected retained take' },
    },
    {
      entity: { eid: artifact },
      artifact: {
        address: 'operation-existing-bytes',
        media_type: 'text/plain',
        size: 4,
      },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: SESSION },
      ask: { to: PERSON },
      usage: { input_tokens: 100, cached_tokens: 50, output_tokens: 10 },
      using: {},
    },
  ])
  let config = '', initDir = '', landDir = '', want = ''
  let git = async (args: string[], cwd: string) => {
    let out = await new Deno.Command('git', {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
    return new TextDecoder().decode(out.stdout).trim()
  }
  return [
    {
      family: 'builder-choose',
      tool: 'builder_choose',
      command: ['builder', 'choose'],
      prepare: async () => {
        await graph.apply([{ entity: { eid: a }, chosen: {} }])
      },
      args: () => ({ output: b }),
      verify: async (text) => {
        includes(text, b)
        let rows = await graph.get([a, b])
        if (rows[0].chosen || !rows[1].chosen) {
          throw new Error('retained choice not switched')
        }
      },
    },
    {
      family: 'builder-supply',
      tool: 'builder_supply',
      command: ['builder', 'supply'],
      args: () => ({ builder, for: TARGET, slot: fresh('supplied'), artifact }),
      verify: async (text, input) => {
        includes(text, 'content')
        await saved(`.built.slot="${input.slot}" ?built ?chosen`, artifact)
      },
    },
    {
      family: 'builder-plan',
      tool: 'builder_build',
      command: ['builder', 'build'],
      args: () => ({ builder, rebuild: true, limit: 1 }),
      verify: async (text) => {
        includes(text, 'content')
        await saved(`.build.builder=${builder} ?build`, 'call')
      },
    },
    {
      family: 'session-cache',
      tool: 'session_cache',
      doors: ['cli'],
      command: ['session', 'cache'],
      args: () => ({ session: SESSION, requests: true }),
      verify: (text) => {
        includes(text, '50')
        includes(text, 'cached')
      },
    },
    {
      family: 'session-listen',
      tool: 'session_listen',
      doors: ['cli'],
      command: ['session', 'listen'],
      prepare: async () => {
        await graph.apply([{
          entity: { eid: crypto.randomUUID() },
          mail: {
            target: SESSION,
            message_id: fresh('listener-message'),
            from: 'sender@operation.invalid',
            to: 'reader@operation.invalid',
          },
          deliver: { to: SESSION },
          doc: {
            title: 'Operation listener mail',
            body: 'Populated listener delivery',
          },
          $actor: { by: PERSON },
        }])
      },
      args: () => ({ session: SESSION, once: true }),
      verify: async (text) => {
        includes(text, 'Operation listener mail')
        await saved('.notified ?mail', 'listener-message')
      },
    },
    {
      family: 'trace-arm',
      tool: 'trace',
      doors: ['cli'],
      registered: false,
      command: ['trace'],
      args: () => ({ next: 1, rate: 0 }),
      verify: async (text) => {
        includes(text, 'next')
        let state = JSON.parse(
          await Deno.readTextFile(`${dir}/yak.db.trace.json`),
        )
        if (state.next !== 1 || state.rate !== 0) {
          throw new Error('trace not armed')
        }
      },
    },
    {
      family: 'init',
      tool: 'init',
      doors: ['cli'],
      registered: false,
      command: ['init', 'Operation initialized person'],
      prepare: async () => {
        initDir = await Deno.makeTempDir({ dir, prefix: 'init-' })
        config = `${initDir}/yak.json`
      },
      config: () => config,
      args: () => ({}),
      verify: async (text) => {
        includes(text, 'Operation initialized person')
        let cfg = JSON.parse(await Deno.readTextFile(config))
        let out = await new Deno.Command(Deno.execPath(), {
          args: [
            'run',
            '-A',
            '--config',
            new URL('../deno.json', import.meta.url).pathname,
            new URL('../packages/cli/yak.ts', import.meta.url).pathname,
            '--config',
            config,
            '--no-duties',
            'graph',
            'show',
            cfg.person,
            '--json',
          ],
          stdout: 'piped',
          stderr: 'piped',
        }).output()
        if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
        includes(
          new TextDecoder().decode(out.stdout),
          'Operation initialized person',
        )
      },
    },
    {
      family: 'land',
      tool: 'land',
      doors: ['cli'],
      command: ['land'],
      prepare: async () => {
        landDir = await Deno.makeTempDir({ dir, prefix: 'land-' })
        await git(['init', '-q', '-b', 'main'], landDir)
        await git(['config', 'user.name', 'Operation'], landDir)
        await git(
          ['config', 'user.email', 'operation@operation.invalid'],
          landDir,
        )
        await Deno.writeTextFile(`${landDir}/owned.txt`, 'base\n')
        await git(['add', '.'], landDir)
        await git(['commit', '-qm', 'base'], landDir)
        await git(
          ['worktree', 'add', '-qb', 'owned', `${landDir}/branch`],
          landDir,
        )
        await Deno.writeTextFile(`${landDir}/branch/owned.txt`, 'landed\n')
        await git(['add', '.'], `${landDir}/branch`)
        await git(['commit', '-qm', 'owned change'], `${landDir}/branch`)
        want = await git(['rev-parse', 'HEAD'], `${landDir}/branch`)
      },
      cwd: () => `${landDir}/branch`,
      args: () => ({}),
      verify: async (text) => {
        includes(text, want)
        if (
          await git(['rev-parse', 'HEAD'], landDir) !== want
        ) throw new Error('land did not advance base')
        includes(await Deno.readTextFile(`${landDir}/owned.txt`), 'landed')
      },
    },
  ]
}
export let measure = measureControls
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
