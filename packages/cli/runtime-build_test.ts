import { equal, test } from '@yaks/testing'
import { runtimeBuild, sourceIdentity } from './runtime.ts'

let files: Record<string, string> = {
  '/proc/1/environ': 'IGNORED=value\0',
  '/proc/1/task/1/children': '2 3',
  '/proc/2/environ':
    'YAK_RUNTIME_ROOT=file:///runtime/0\0YAK_RUNTIME_COMMIT=abc\0',
  '/runtime/0/.hash': 'source-hash',
}
let read = (path: string | URL) => {
  let file = String(path)
  if (!(file in files)) return Promise.reject(new Deno.errors.NotFound(file))
  return Promise.resolve(files[file])
}
test('a launcher build follows its pinned child, independent of its process id', async () => {
  equal(await runtimeBuild(1, read), {
    hash: 'source-hash',
    root: 'file:///runtime/0',
    from: undefined,
    commit: 'abc',
  })
  equal(await runtimeBuild(2, read), {
    hash: 'source-hash',
    root: 'file:///runtime/0',
    from: undefined,
    commit: 'abc',
  })
})
test('a vanished runtime has no attributed build', async () => {
  equal(await runtimeBuild(99, read), undefined)
})

let source = (path: string, value: string) => ({
  path,
  bytes: new TextEncoder().encode(value),
})
let production = [
  source('packages/web/main.ts', 'paint()'),
  source('packages/web/styles.css', 'body {}'),
  source('deno.lock', 'lock'),
]
let initial = await sourceIdentity(production)
let docs = await sourceIdentity([
  ...production,
  source('README.md', 'edited'),
  source('packages/web/main_test.ts', 'test()'),
])
let styled = await sourceIdentity([
  ...production.slice(0, 1),
  source('packages/web/styles.css', 'body {color:red}'),
  production[2],
])
test('production content survives docs and tests changes but sees stylesheet changes', () => {
  equal(initial, docs)
  equal(initial == styled, false)
})
