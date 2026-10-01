// The machine tools' declarations keep values the operating system cannot
// receive from reaching a machine. Their behavior otherwise belongs to the
// machines' own interface tests.

import { assertEquals, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { validateToolInput } from '@yaks/vocab/tools'
import { machineDeclared } from './machine.ts'

let tool = (name: string) => ({
  inputSchema: machineDeclared().find((tool) => tool.name == name)!.parameters,
})

test('a nul byte is refused before a machine receives it', () => {
  for (
    let [name, args] of [
      ['shell', { command: "grep 'data/m\0' /dev/null" }],
      ['shell', { command: 'pwd', cwd: '/tmp\0elsewhere' }],
      ['read', { path: '/tmp/file\0other' }],
      ['write', { path: '/tmp/file\0other', content: 'kept\0whole' }],
    ] as const
  ) {
    assertThrows(() => validateToolInput(tool(name), args))
  }

  assertEquals(
    validateToolInput(tool('write'), {
      path: '/tmp/file',
      content: 'kept\0whole',
    }),
    { path: '/tmp/file', content: 'kept\0whole' },
  )
})
