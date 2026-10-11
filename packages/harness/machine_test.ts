// The machine tools' declarations keep values the operating system cannot
// receive from reaching a machine and start commands in the bound directory.

import { assertEquals, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { validateToolInput } from '@yaks/vocab/tools'
import type { Machine } from '@yaks/machine'
import { machineDeclared, machineTools } from './machine.ts'

let tool = (name: string) => ({
  inputSchema: machineDeclared().find((tool) => tool.name == name)!.parameters,
})

test('every session shell starts in its home despite a caller cwd', async () => {
  let starts: (string | undefined)[] = []
  let machine: Machine = {
    start: (_command, cwd) => {
      starts.push(cwd)
      return Promise.resolve('process')
    },
    look: () => Promise.resolve({ exit: { code: 0 } }),
    tail: () => Promise.resolve([]),
    kill: () => Promise.resolve(),
    read: () => Promise.resolve(''),
    write: () => Promise.resolve(),
  }
  let homes: Record<string, string> = { parent: '/worktree', child: '/child' }
  let shell = machineTools(() => Promise.resolve(machine), {
    cwd: (ctx) => Promise.resolve(homes[ctx!.session]),
  }).find((tool) => tool.name == 'shell')!
  let ctx = {
    session: 'parent',
    call: { entity: { eid: 'shell-call' } },
    entries: [],
  }
  for (let cwd of [undefined, '/main', '.', 'sub']) {
    assertEquals(
      await shell.run({ command: 'pwd', cwd }, ctx),
      'process process exited 0',
    )
  }
  homes.parent = '/next-worktree'
  await shell.run({ command: 'pwd' }, ctx)
  await shell.run({ command: 'pwd', cwd: '/main' }, {
    ...ctx,
    session: 'child',
  })
  assertEquals(starts, [
    '/worktree',
    '/worktree',
    '/worktree',
    '/worktree',
    '/next-worktree',
    '/child',
  ])
})

test('a nul byte is refused before a machine receives it', () => {
  for (
    let [name, args] of [
      ['shell', { command: "grep 'data/m\0' /dev/null" }],
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
