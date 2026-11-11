import { equal, ok, test, throws } from '@yaks/testing'
import * as io from './io.ts'

let root = await io.makeTempDir()
let path = `${root}/bytes`
await io.writeTextFile(path, 'abc')
let lockPath = `${root}/lock`
let first = await io.open(lockPath, { create: true, write: true })
let second = await io.open(lockPath, { write: true })
let observed: string[] = []
let unwatch = io.watchReads((path) => observed.push(String(path)))
await io.readTextFile(path)
unwatch()

test('file reads, seeks and writes retain their descriptor position', async () => {
  using file = await io.open(path, { read: true, write: true })
  equal(await file.seek(-1, io.SeekMode.End), 2)
  equal(await file.write(new TextEncoder().encode('z')), 1)
  equal(file.seekSync(0, io.SeekMode.Start), 0)
  let bytes = new Uint8Array(3)
  equal(file.readSync(bytes), 3)
  equal(new TextDecoder().decode(bytes), 'abz')
  equal(await file.read(bytes), null)
  equal(await io.readTextFile(path), 'abz')
  ok((await file.stat()).mtime instanceof Date)
  ok(io.statSync(path).mtime instanceof Date)
})

test('exclusive creation refuses overwrite and missing input has a shared error', () => {
  throws(() => io.writeTextFileSync(path, 'lost', { createNew: true }))
  try {
    io.readTextFileSync(`${root}/missing`)
  } catch (error) {
    ok(error instanceof io.errors.NotFound)
    return
  }
  throw new Error('missing input was accepted')
})

test('descriptor locks contend and closing releases the holder', async () => {
  ok(first.tryLockSync(true))
  equal(second.tryLockSync(true), false)
  first.close()
  ok(await second.tryLock(true))
  await second.unlock()
  second.close()
})

test('filesystem observers receive inputs while subscribed', () => {
  equal(observed, [path])
})

test('shared readers exclude a writer across hardlink names', async () => {
  let path = `${root}/shared`
  await io.writeTextFile(path, '')
  await io.link(path, path + '.alias')
  using a = await io.open(path)
  using b = await io.open(path + '.alias')
  using writer = await io.open(path)
  ok(a.tryLockSync())
  ok(b.tryLockSync())
  equal(writer.tryLockSync(true), false)
  await a.unlock()
  equal(writer.tryLockSync(true), false)
  await b.unlock()
  ok(writer.tryLockSync(true))
})

test('a forced remove of a path already gone succeeds, and an unforced one throws', async () => {
  let missing = `${root}/never`
  throws(() => io.removeSync(missing, { recursive: true }))
  io.removeSync(missing, { recursive: true, force: true })
  io.removeSync(missing, { force: true })
  await io.remove(missing, { recursive: true, force: true })
  await io.remove(missing, { force: true })
})
