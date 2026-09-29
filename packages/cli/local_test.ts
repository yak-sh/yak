// A command can read a graph that owes effects and leave those runs for the
// process serving duties. The CLI closes and exits without starting a worker.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { detached } from '@yaks/graph'
import { compose, read } from './host.ts'

test('a graph read exits and leaves owed effects unclaimed', async () => {
  let dir = await Deno.makeTempDir()
  let file = `${dir}/yak.json`
  await Deno.writeTextFile(
    file,
    JSON.stringify({
      db: 'yak.db',
      plugins: ['@yaks/effects', '@yaks/process'],
    }),
  )
  try {
    let host = await compose(read(file), ['graph'])
    try {
      await detached(host.storage).patch([{
        entity: { eid: 'owed' },
        effect: {
          handler: 'slow',
          target: 'owed',
          comp: 'effect',
          kind: 'created',
          state: 'pending',
          attempts: 0,
        },
      }])
    } finally {
      await host.close()
    }

    let line = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        '--config',
        new URL('../../deno.json', import.meta.url)
          .pathname,
        new URL('./yak.ts', import.meta.url).pathname,
        'graph',
        'show',
        'owed',
        '--config',
        file,
        '--json',
      ],
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let timedOut = false
    let deadline = setTimeout(() => {
      timedOut = true
      line.kill('SIGKILL')
    }, 5000)
    let result
    try {
      result = await line.output()
    } finally {
      clearTimeout(deadline)
    }
    assert(!timedOut, 'graph show did not exit after answering')
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr))
    assert(new TextDecoder().decode(result.stdout).includes('owed'))

    let after = await compose(read(file), ['graph'])
    try {
      let [row] = await after.graph.read('.effect')
      let effect = row.effect
      assert(effect && typeof effect == 'object')
      assertEquals('state' in effect && effect.state, 'pending')
      assertEquals('attempts' in effect && effect.attempts, 0)
      assert(!('lease_owner' in effect) || effect.lease_owner == null)
    } finally {
      await after.close()
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
