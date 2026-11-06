// Worktree occupancy compares paths; the scan reads this host's processes.
import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { inUse, processPaths } from './host.ts'

test('process directories protect a worktree and its descendants', () => {
  for (
    let [cwd, held] of [
      ['/work/tree', true],
      ['/work/tree/subdir', true],
      ['/work/tree-other', false],
      ['/work', false],
    ] as const
  ) assertEquals(inUse('/work/tree', new Set([cwd])), held)
})

// ssh-agent makes itself non-dumpable; with its cwd deleted, even the
// privileged helper refuses it.
test('a process the scan cannot read holds nothing', async () => {
  let [dir, sock] = [await Deno.makeTempDir(), await Deno.makeTempDir()]
  let agent = new Deno.Command('ssh-agent', {
    args: ['-D', '-a', sock + '/agent'],
    cwd: dir,
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  try {
    await until(() => Deno.stat(sock + '/agent').then(() => true, () => false))
    await Deno.remove(dir, { recursive: true })
    let paths = await processPaths([String(agent.pid), '4194304'])
    assertEquals([...paths].filter((path) => path.startsWith(dir)), [])
    assert((await processPaths([String(Deno.pid)])).has(Deno.cwd()))
  } finally {
    agent.kill()
    await agent.status
    await Deno.remove(sock, { recursive: true })
  }
}, { skip: Deno.build.os != 'linux' })
