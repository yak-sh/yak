/** Checkout-specific citations and honest MCP cwd refusals. These refused
 * operations measure the real unavailable boundary, never successful sync or
 * landing. A missing MCP process.cwd remains an explicit product dependency. */
import type { Operation } from './operation-commands.ts'
import type { OperationContext } from './operation-local.ts'
import { measureCheckout } from './operation-commands.ts'
import { link } from '@yaks/edge'
import { identities } from '@yaks/graph/identity'
export let CHECKOUT_NAMES = [
  'cli/file-cites-verify',
  'cli/file-cites-check',
  'connector/code-sync-cwd-refusal',
  'connector/land-cwd-refusal',
  'connector/file-cites-verify-cwd-refusal',
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
  let repositories = await graph.read('.repository *')
  let repository = repositories.find((r) =>
    (r.repository as { common?: string })?.common == `${path}/.git`
  )
  if (!repository) throw new Error('missing owned repository')
  let file = identities(graph.vocab).file({
    path: 'mod.ts',
    root: repository.entity.eid,
  }, { entity: { eid: '' } })
  await graph.apply([{
    entity: { eid: file },
    file: { path: 'mod.ts', root: repository.entity.eid },
  }])
  let citation = link(PERSONA, 'cites', file)
  await graph.apply([citation])
  let prepare = async () => {
    await graph.apply([{
      entity: citation.entity,
      verified: null,
      revision: null,
    }])
  }
  let refuse = (
    family: string,
    tool: string,
    command: string[],
    args: () => Record<string, unknown>,
  ): Operation => ({
    family,
    tool,
    command,
    doors: ['connector'],
    expectedError: true,
    prepare,
    args,
    verify: (text) => {
      includes(text, 'cwd')
      includes(text, 'checkout')
    },
  })
  return [
    {
      family: 'file-cites-verify',
      tool: 'cites_verify',
      command: ['cites', 'verify'],
      doors: ['cli'],
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
    refuse(
      'code-sync-cwd-refusal',
      'code_sync',
      ['code', 'sync'],
      () => ({ full: true }),
    ),
    refuse('land-cwd-refusal', 'land', ['land'], () => ({})),
    refuse(
      'file-cites-verify-cwd-refusal',
      'cites_verify',
      ['cites', 'verify'],
      () => ({ cite: citation.entity.eid }),
    ),
  ]
}
export let measure = measureCheckout
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
