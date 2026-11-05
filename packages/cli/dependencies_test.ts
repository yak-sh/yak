import { test } from '@yaks/testing'
import * as io from '@yaks/file/io'
import { assertEquals } from '@std/assert'
import { stale } from './dependencies.ts'

let checkout = (wanted?: string, installed?: string) => {
  let root = io.makeTempDirSync({ prefix: 'dependencies-' })
  if (wanted != null) io.writeTextFileSync(`${root}/pnpm-lock.yaml`, wanted)
  if (installed != null) {
    io.mkdirSync(`${root}/node_modules/.pnpm`, { recursive: true })
    io.writeTextFileSync(`${root}/node_modules/.pnpm/lock.yaml`, installed)
  }
  return root
}

test('a checkout is stale until node_modules holds its lockfile', () => {
  for (
    let [wanted, installed, want] of [
      ['a', 'a', false],
      ['---\npnpm: 12\n\n---\na', 'a', false],
      ['a', 'b', true],
      ['a', undefined, true],
      [undefined, undefined, false],
    ] as [string | undefined, string | undefined, boolean][]
  ) {
    let root = checkout(wanted, installed)
    try {
      assertEquals(stale(root), want, `${wanted} installed as ${installed}`)
    } finally {
      io.removeSync(root, { recursive: true })
    }
  }
})
