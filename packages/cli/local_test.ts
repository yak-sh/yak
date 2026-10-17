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
    let host = await compose(read(file), ['graph'], undefined, {})
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

// Exercise the actual command and reopen its store before timing the checks.
let quietComment = await (async () => {
  let dir = await Deno.makeTempDir({ prefix: 't127020-' })
  let listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (listener.addr as Deno.NetAddr).port
  listener.close()
  let file = `${dir}/yak.json`
  await Deno.writeTextFile(
    file,
    JSON.stringify({
      db: 'yak.db',
      port,
      plugins: ['@yaks/kernel', '@yaks/doc', '@yaks/effects', '@yaks/process'],
    }),
  )
  try {
    let host = await compose(read(file), ['graph'], undefined, {})
    try {
      await detached(host.storage).patch([{
        entity: { eid: 'owed' },
        doc: { title: 'Scratch target' },
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
        'comment',
        'new',
        '--target',
        'owed',
        '--body',
        'scratch comment',
        '--config',
        file,
        '--json',
      ],
      env: { HARNESS_HOME: `${dir}/harness`, TASKS_HOME: `${dir}/tasks` },
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
    let after = await compose(read(file), ['graph'])
    try {
      let comments = await after.graph.read('.comment ?doc')
      let [row] = await after.graph.read('.effect')
      let effect = row.effect
      return { timedOut, result, comments, effect }
    } finally {
      await after.close()
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})()
test('a CLI comment write exits quietly and leaves owed effects unclaimed', () => {
  let { timedOut, result, comments, effect } = quietComment
  assert(!timedOut, 'comment write did not exit after answering')
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr))
  assertEquals(new TextDecoder().decode(result.stderr), '')
  assert(new TextDecoder().decode(result.stdout).includes('scratch comment'))
  assertEquals(comments.length, 1)
  assertEquals((comments[0].doc as { body: string }).body, 'scratch comment')
  assert(effect && typeof effect == 'object')
  assertEquals('state' in effect && effect.state, 'pending')
  assertEquals('attempts' in effect && effect.attempts, 0)
  assert(!('lease_owner' in effect) || effect.lease_owner == null)
})
