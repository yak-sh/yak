import { assertEquals } from '@std/assert'
import { type Act, type Binding, blobOf, decide, memo, sync } from './mod.ts'

// The decision table, one row per case: file, value, agreed blob, agreed hash,
// and which directions the binding has.
let row = (
  file: string | undefined,
  value: string | undefined,
  agreed: [string, string?] | undefined,
  can: { read?: boolean; write?: boolean },
): Act =>
  decide({
    file,
    value,
    agreed: agreed && { blob: agreed[0], hash: agreed[1] },
  }, can)

let R = { read: true }
let W = { write: true }
let RW = { read: true, write: true }

Deno.test('decide: read-only follows the file', () => {
  assertEquals(row('a', undefined, ['a'], R), 'same')
  assertEquals(row('b', undefined, ['a'], R), 'read')
  assertEquals(row('a', undefined, undefined, R), 'read')
  assertEquals(row(undefined, undefined, ['a'], R), 'read') // gone
})

Deno.test('decide: write-only follows the graph, and a double move conflicts', () => {
  assertEquals(row('a', 'a', ['a', 'a'], W), 'same')
  assertEquals(row('a', 'b', ['a', 'a'], W), 'write')
  assertEquals(row('x', 'a', ['a', 'a'], W), 'write') // a hand edit is put back
  assertEquals(row('x', 'b', ['a', 'a'], W), 'conflict')
  assertEquals(row('x', 'b', undefined, W), 'write') // nothing remembered
  assertEquals(row('a', undefined, ['a', 'a'], W), 'write') // removed
  assertEquals(row('x', undefined, ['a', 'a'], W), 'conflict')
  assertEquals(row(undefined, undefined, ['a', 'a'], W), 'same')
  assertEquals(row(undefined, 'b', ['a', 'a'], W), 'write') // deleted to resolve
})

Deno.test('decide: both ways reads a file move and writes a graph move', () => {
  assertEquals(row('b', 'a', ['a', 'a'], RW), 'read')
  assertEquals(row('a', 'b', ['a', 'a'], RW), 'write')
  assertEquals(row('b', 'c', ['a', 'a'], RW), 'conflict')
  assertEquals(row('b', 'c', undefined, RW), 'conflict')
  assertEquals(row(undefined, 'c', undefined, RW), 'write')
  assertEquals(row('b', undefined, undefined, RW), 'read')
})

let text = (p: string) => Deno.readTextFileSync(p)

Deno.test('sync: writes, keeps a hand edit the graph also moved, and removes', async () => {
  let dir = Deno.makeTempDirSync()
  let a = `${dir}/x/a.md`
  let b = `${dir}/b.md`
  let want = new Map([[a, 'one\n'], [b, 'two\n']])
  let bind: Binding = {
    name: 't',
    files: async () => {
      let out = new Map<string, string>()
      for (let p of [a, b]) {
        try {
          out.set(p, await blobOf(text(p)))
        } catch { /* absent */ }
      }
      return out
    },
    values: () => Promise.resolve(want),
    ...memo(`${dir}/memo.json`),
  }
  assertEquals((await sync(bind)).wrote, [b, a])
  assertEquals(await sync(bind), {
    read: [],
    wrote: [],
    removed: [],
    conflicts: [],
    failed: [],
  })
  Deno.writeTextFileSync(a, 'hand\n')
  want = new Map([[a, 'one again\n']])
  let got = await sync(bind)
  assertEquals([got.conflicts, got.removed], [[a], [b]])
  assertEquals(text(a), 'hand\n')
  Deno.removeSync(dir, { recursive: true })
})

Deno.test('sync: a read binding reads what moved and what is gone', async () => {
  let files = new Map([['a', '1'], ['b', '2']])
  let seen: [string[], string[]][] = []
  let bind: Binding = {
    name: 't',
    files: () => Promise.resolve(files),
    read: (paths, gone) => Promise.resolve(void seen.push([paths, gone])),
    agreed: () =>
      Promise.resolve(new Map([['a', { blob: '1' }], ['c', { blob: '3' }]])),
  }
  assertEquals((await sync(bind)).read, ['b', 'c'])
  assertEquals(seen, [[['b', 'c'], ['c']]])
})
