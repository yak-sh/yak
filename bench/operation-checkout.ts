/** Checkout-specific citations and code sync through the CLI and connector. */
import type { Operation } from './operation-commands.ts'
import type { OperationContext } from './operation-local.ts'
import { measureCheckout } from './operation-commands.ts'
import { link } from '@yaks/edge'
import type { Comp } from '@yaks/graph'
import { discover } from '@yaks/git/host'
import { identities } from '@yaks/graph/identity'
export let CHECKOUT_NAMES = [
  'cli/file-cites-verify',
  'cli/file-cites-check',
  'connector/file-cites-verify',
  'connector/code-sync',
]
export let checkoutOperations = async (
  c: OperationContext,
): Promise<Operation[]> => {
  let { graph, dir, PERSONA, includes, saved } = c
  let path = `${dir}/checkout`
  let git = async (args: string[]) => {
    let out = await new Deno.Command('git', {
      args,
      cwd: path,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
    return new TextDecoder().decode(out.stdout).trim()
  }
  await git(['add', '.'])
  await git(['commit', '-qm', 'owned citation fixture'])
  let head = await git(['rev-parse', 'HEAD'])
  let root = String(((await discover(graph, path)).worktree as Comp).repository)
  // The historical vocabulary calls the same repository file.repository.
  let key = graph.vocab.identity('file').includes('root')
    ? 'root'
    : 'repository'
  let source = { path: 'mod.ts', [key]: root }
  let file = identities(graph.vocab).file(source, {
    entity: { eid: '' },
  })
  await graph.apply([{ entity: { eid: file }, file: source }])
  let citation = link(PERSONA, 'cites', file)
  await graph.apply([citation])
  let prepare = async () => {
    await graph.apply([{
      entity: citation.entity,
      verified: null,
      revision: null,
    }])
  }
  return [
    {
      family: 'file-cites-verify',
      tool: 'cites_verify',
      command: ['cites', 'verify'],
      doors: ['cli', 'connector'],
      cwd: path,
      prepare,
      args: () => ({ cite: citation.entity.eid }),
      verify: async (text) => {
        includes(text, 'verified')
        await saved(`.entity.eid=${citation.entity.eid} ?revision`, head)
      },
    },
    {
      family: 'file-cites-check',
      tool: 'cites_check',
      command: ['cites', 'check'],
      doors: ['cli'],
      cwd: path,
      prepare,
      args: () => ({ of: PERSONA, path: 'mod.ts' }),
      verify: (text) => includes(text, 'never checked'),
    },
    {
      family: 'code-sync',
      tool: 'code_sync',
      command: ['code', 'sync'],
      doors: ['connector'],
      args: () => ({ full: true }),
      verify: async (text) => {
        includes(text, 'read 2 files')
        await saved('.symbol.name=operationValue', 'operationValue')
        await saved('.package.name="@operation/fixture"', '@operation/fixture')
      },
    },
  ]
}
export let measure = measureCheckout
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
