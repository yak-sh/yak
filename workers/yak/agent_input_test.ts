import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { inputSchemaOf } from '@yaks/tools/schema'
import { argsFor, Usage } from '../../packages/cli/args.ts'
import { sugared } from './agent.ts'
import { type Ctx, TOOLS } from './tools.ts'

let tool = sugared(
  { env: {} } as Ctx,
  TOOLS.find((t) => t.name == 'connection_lend')!,
)
let grammar = { name: tool.name, inputSchema: inputSchemaOf(tool) }
let words = ['--app', 'bible-study', '--integration', 'ESV']

test('a listed lending schema lets the CLI pass a monthly cap or stop lending', async () => {
  assertEquals(await argsFor(grammar, [...words, '--cap', '100']), {
    app: 'bible-study',
    integration: 'ESV',
    cap: 100,
  })
  assertEquals(await argsFor(grammar, [...words, '--clear', 'cap']), {
    app: 'bible-study',
    integration: 'ESV',
    cap: null,
  })
})

for (let cap of [[], ['--cap', '1.5'], ['--cap', '0']]) {
  test(`a listed lending schema refuses cap ${cap.at(-1) ?? 'omitted'}`, async () => {
    await assertRejects(() => argsFor(grammar, [...words, ...cap]), Usage)
  })
}
