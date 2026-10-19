/** Filesystem and text-search operations over owned paths only. Code sync
 * crosses the real process-cwd boundary; persona sync writes an owned checkout. */
import { link } from '@yaks/edge'
import { identities } from '@yaks/graph/identity'
import type { Operation } from './operation-commands.ts'
import type { OperationContext } from './operation-local.ts'
export let FILE_FAMILIES = [
  'code-sync',
  'persona-sync',
  'search',
  'cites-verify',
  'cites-check',
]
export let fileOperations = async (
  c: OperationContext,
): Promise<Operation[]> => {
  let { graph, dir, PROJECT, PERSONA, fresh, saved, includes } = c
  let path = `${dir}/checkout`
  await Deno.mkdir(path, { recursive: true })
  for (
    let args of [['init', '-q'], [
      'config',
      'user.email',
      'operation@operation.invalid',
    ], ['config', 'user.name', 'Operation']]
  ) {
    let out = await new Deno.Command('git', {
      args,
      cwd: path,
      stdout: 'null',
      stderr: 'piped',
    }).output()
    if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
  }
  await Deno.writeTextFile(
    `${path}/deno.json`,
    JSON.stringify({
      name: '@operation/fixture',
      version: '0.0.0',
      exports: './mod.ts',
    }),
  )
  await Deno.writeTextFile(
    `${path}/mod.ts`,
    '/** Operation exported module. */\nexport let operationValue = 42\n',
  )
  await new Deno.Command('git', { args: ['add', '.'], cwd: path }).output()
  let workspace = crypto.randomUUID()
  let repo = identities(graph.vocab).repository({
    workspace,
    common: `${path}/.git`,
  }, { entity: { eid: '' } })
  await graph.apply([
    {
      entity: { eid: workspace },
      workspace: { root: path },
      worktree: { repository: repo, gitdir: `${path}/.git` },
    },
    {
      entity: { eid: repo },
      repository: { workspace, common: `${path}/.git` },
    },
    {
      entity: { eid: PROJECT },
      repo: { repository: repo, base_branch: 'main' },
    },
    { entity: { eid: PERSONA }, persona: { home: PROJECT } },
  ])
  let citation = link(PERSONA, 'cites', PROJECT)
  await graph.apply([citation])
  return [
    {
      family: 'code-sync',
      doors: ['cli'],
      tool: 'code_sync',
      command: ['code', 'sync'],
      cwd: path,
      args: () => ({ full: true }),
      verify: async (text) => {
        includes(text, 'read 2 files')
        await saved('.symbol.name=operationValue', 'operationValue')
        await saved('.package.name="@operation/fixture"', '@operation/fixture')
      },
    },
    {
      family: 'persona-sync',
      tool: 'persona_sync',
      command: ['persona', 'sync'],
      prepare: async () => {
        await graph.apply([{
          entity: { eid: PERSONA },
          doc: { body: fresh('persona file') },
        }])
      },
      args: () => ({}),
      verify: async (text) => {
        includes(text, 'wrote')
        let texts = []
        for await (let e of Deno.readDir(`${path}/.tasks/personas`)) {
          texts.push(
            await Deno.readTextFile(`${path}/.tasks/personas/${e.name}`),
          )
        }
        includes(texts.join('\n'), 'persona file')
      },
    },
    {
      family: 'cites-verify',
      tool: 'cites_verify',
      command: ['cites', 'verify'],
      prepare: async () => {
        await graph.apply([{
          entity: citation.entity,
          verified: null,
          cites: { hash: null },
        }])
      },
      args: () => ({ cite: citation.entity.eid }),
      verify: async (text) => {
        includes(text, 'verified')
        await saved(
          `.entity.eid=${citation.entity.eid} ?cites ?verified`,
          'hash',
        )
      },
    },
    {
      family: 'cites-check',
      tool: 'cites_check',
      command: ['cites', 'check'],
      prepare: async () => {
        await graph.apply([{
          entity: { eid: PROJECT },
          doc: { body: fresh('cited project changed') },
        }])
      },
      args: () => ({ of: PERSONA }),
      verify: (text) => includes(text, 'never checked'),
    },
    {
      family: 'search',
      tool: 'search',
      command: ['search'],
      args: () => ({ words: 'Operation exported module', limit: 10 }),
      verify: (text) => includes(text, 'mod.ts'),
    },
  ]
}
