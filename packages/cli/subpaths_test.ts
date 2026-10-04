/** Selected facets share a dependency graph, without importing optional roles
 * or turning a broken exported facet into an absent one. */
import { equal, ok, test, throws } from '@yaks/testing'
import { subpath, subpaths } from './config.ts'

let fixture = () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-subpaths-' })
  let plugin = new URL(`file://${dir}/`).href.replace(/\/$/, '')
  return { dir, plugin }
}

test('selected facet modules keep request order, shared exports, and module identity', async () => {
  let { dir, plugin } = fixture()
  try {
    Deno.writeTextFileSync(`${dir}/shared.ts`, 'export let value = {}\n')
    Deno.writeTextFileSync(
      `${dir}/vocab.ts`,
      "export { value } from './shared.ts'\n",
    )
    Deno.writeTextFileSync(
      `${dir}/graph.ts`,
      "export { value } from './shared.ts'\n",
    )
    Deno.writeTextFileSync(
      `${dir}/effects.ts`,
      "throw Error('unselected role ran')\nexport {}\n",
    )
    let [graph, vocab, duplicate] = await subpaths([
      [plugin, 'graph.ts'],
      [plugin, 'vocab.ts'],
      [plugin, 'graph.ts'],
    ]) as { value: object }[]
    equal(graph.value, vocab.value)
    ok(graph === duplicate)
    ok(graph === await subpath(plugin, 'graph.ts'))
    equal(await subpaths([]), [])
    equal(await subpaths([['@yaks/doc', 'routes']]), [null])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('a broken selected module fails the load without poisoning another selected module', async () => {
  let { dir, plugin } = fixture()
  try {
    Deno.writeTextFileSync(`${dir}/vocab.ts`, 'export let docs = []\n')
    Deno.writeTextFileSync(
      `${dir}/graph.ts`,
      "throw Error('broken exported facet')\nexport {}\n",
    )
    await throws(() => subpaths([[plugin, 'vocab.ts'], [plugin, 'graph.ts']]))
    let good = await subpath<{ docs: unknown[] }>(plugin, 'vocab.ts')
    equal(good?.docs, [])
    await throws(() => subpath(plugin, 'graph.ts'))
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('an absent file facet does not break another selected module', async () => {
  let { dir, plugin } = fixture()
  try {
    Deno.writeTextFileSync(`${dir}/vocab.ts`, 'export let docs = []\n')
    let [good, absent] = await subpaths([[plugin, 'vocab.ts'], [
      plugin,
      'missing.ts',
    ]]) as [{ docs: unknown[] }, null]
    equal(good.docs, [])
    equal(absent, null)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
