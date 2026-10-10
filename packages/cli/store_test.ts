// A roster belongs to one door; an old combined cache moves without losing
// other doors or bringing a forgotten roster back.
import { equal, test } from '@yaks/testing'
import { type RosterFiles, rosters } from './store.ts'

let memoryFiles = () => {
  let files = new Map<string, string>()
  let absent = new Deno.errors.NotFound('absent file')
  let present = new Deno.errors.AlreadyExists('existing file')
  let read = (path: string) => {
    if (!files.has(path)) throw absent
    return files.get(path)!
  }
  let remove = (path: string) => {
    if (!files.delete(path)) throw absent
  }
  let io: RosterFiles = {
    readTextFileSync: read,
    mkdirSync: () => {},
    writeTextFileSync: (path, text) => void files.set(path, text),
    renameSync: (from, to) => {
      files.set(to, read(from))
      remove(from)
    },
    linkSync: (from, to) => {
      if (files.has(to)) throw present
      files.set(to, read(from))
    },
    removeSync: remove,
    statSync: read,
  }
  return { files, ...rosters(io) }
}

let one = { tools: [{ name: 'one' }] }, two = { tools: [{ name: 'two' }] }
test('rosters move to independent files and forgetting one keeps the others', async () => {
  let { files, cached, forget, remember } = memoryFiles()
  let dir = '/memory'
  files.set(
    `${dir}/tools.json`,
    JSON.stringify({
      'example.test/a': one,
      'example.test/b': two,
    }),
  )
  equal(await cached('example.test/a', dir), one)
  equal(await cached('example.test/b', dir), two)
  equal(files.has(`${dir}/tools.json`), false)
  equal(files.size, 2)
  await forget('example.test/a', dir)
  equal(await cached('example.test/a', dir), null)
  equal(await cached('example.test/b', dir), two)
  await remember('example.test/a', two, dir)
  equal(await cached('example.test/a', dir), two)
})
test('an interrupted roster move preserves newer destinations on retry', async () => {
  let { files, cached, remember } = memoryFiles()
  let dir = '/memory'
  await remember('example.test/a', two, dir)
  files.set(
    `${dir}/tools.json`,
    JSON.stringify({
      'example.test/a': one,
      'example.test/b': one,
    }),
  )
  equal(await cached('example.test/a', dir), two)
  equal(await cached('example.test/b', dir), one)
})
