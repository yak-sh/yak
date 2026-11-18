// Filesystem trash preserves bytes, names and restore metadata through its door.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { restore, trash } from './trash.ts'

let dir = await Deno.makeTempDir()
let root = `${dir}/trash`
let file = `${dir}/notes`
Deno.mkdirSync(file)
Deno.writeTextFileSync(`${file}/draft.txt`, 'precious')
let record = (await trash(file, root))!
Deno.writeTextFileSync(file, 'taken')
let restored = await restore(record)

test('trash restores a directory under a free name when its path was reused', async () => {
  assertEquals(Deno.readTextFileSync(file), 'taken')
  assertEquals(Deno.readTextFileSync(`${restored}/draft.txt`), 'precious')
  assertEquals(
    JSON.parse(Deno.readTextFileSync(`${record}/source.json`)).path,
    file,
  )
  assertEquals(restored.startsWith(`${file}.restored-`), true)
  assertEquals(await trash(`${dir}/absent`, root), undefined)
})

let shared = `${dir}/shared.txt`
Deno.writeTextFileSync(shared, 'one')
let first = (await trash(shared, root))!
Deno.writeTextFileSync(shared, 'two')
let second = (await trash(shared, root))!
let recovered = await Promise.all([restore(first), restore(second)])

test('concurrent restorations never overwrite a destination another restore claimed', () => {
  assertEquals(new Set(recovered).size, 2)
  assertEquals(recovered.map((p) => Deno.readTextFileSync(p)).sort(), [
    'one',
    'two',
  ])
})
