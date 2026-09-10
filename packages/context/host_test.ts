import { assertEquals, assertRejects } from '@std/assert'
import { instructionFiles } from './host.ts'
Deno.test('generated files remain disk snapshots, aliases dedupe, invalid reads fail', async () => {
  let dir = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(dir + '/.agents')
    let text = '<!-- GENERATED from N-1 (https://example.test/N-1) -->\nRules'
    Deno.writeTextFileSync(dir + '/AGENTS.md', text)
    Deno.symlinkSync(dir + '/AGENTS.md', dir + '/.agents/AGENTS.md')
    let entries = (await instructionFiles(dir, dir)).filter((x) =>
      x.source.startsWith(dir)
    )
    assertEquals(entries.length, 1)
    assertEquals(entries[0].body, text)
    assertEquals(entries[0].source, await Deno.realPath(dir + '/AGENTS.md'))
    Deno.mkdirSync(dir + '/nested')
    Deno.mkdirSync(dir + '/nested/AGENTS.md')
    await assertRejects(() => instructionFiles(dir + '/nested', dir))
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
