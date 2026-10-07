// A provider can be reconstructed using only its configuration and machine
// id. These tests use actual files and tracked processes, not a fake Machine.

import { assertEquals, assertMatch, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { processDoc, processes } from '@yaks/process'
import { machineTools } from '@yaks/harness/machine'
import { processProvider } from './machine.ts'

let tracked = () => {
  let vocab = loadVocab([processDoc])
  return graph({ storage: ram(vocab), vocab, plugins: [processes()] })
}

test('each sandbox has its own directory, survives wake and releases independently', async () => {
  let dir = await Deno.makeTempDir()
  let g = tracked()
  let options = { dir, processes: { dir: `${dir}/processes`, poll: 5 } }
  let provider = processProvider(g, options)
  let a = { id: crypto.randomUUID() }
  let b = { id: crypto.randomUUID() }
  try {
    let first = await provider.request!(a)
    let second = await provider.request!(b)
    await first.machine.write('shared-name.txt', 'first')
    await second.machine.write('shared-name.txt', 'second')
    // A command with no cwd runs in the sandbox, rather than this process's cwd.
    let shell = machineTools(first.machine).find((t) => t.name == 'shell')!
    assertMatch(
      await shell.run({ command: 'cat shared-name.txt' }),
      /exited 0\nfirst$/,
    )
    let replacement = processProvider(g, options)
    assertEquals(
      await (await replacement.wake(a)).machine.read('shared-name.txt'),
      'first',
    )
    assertEquals(
      await (await replacement.request!(a)).machine.read('shared-name.txt'),
      'first',
    )
    await replacement.release(a)
    await replacement.release(a)
    await assertRejects(() => replacement.wake(a), Deno.errors.NotFound)
    assertEquals(await second.machine.read('shared-name.txt'), 'second')
  } finally {
    await provider.release(a)
    await provider.release(b)
    await Deno.remove(dir, { recursive: true })
  }
})

test('attached directories are explicit and are never destroyed by release', async () => {
  let dir = await Deno.makeTempDir()
  let provider = processProvider(tracked(), { dir: `${dir}/sandboxes` })
  let ref = { id: 'named-machine', address: dir }
  try {
    let attached = await provider.attach!(ref)
    await attached.machine.write('kept.txt', 'kept')
    await provider.release(ref)
    await provider.release(ref)
    assertEquals(
      await (await provider.wake(ref)).machine.read('kept.txt'),
      'kept',
    )
    await assertRejects(() =>
      provider.attach!({ id: 'missing', address: `${dir}/missing` })
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('export ships binary files and refuses paths outside the sandbox', async () => {
  let dir = await Deno.makeTempDir()
  let provider = processProvider(tracked(), { dir })
  let ref = { id: crypto.randomUUID() }
  try {
    let { cwd } = await provider.request!(ref)
    let bytes = new Uint8Array([0, 255, 127, 0])
    await Deno.writeFile(`${cwd}/file.bin`, bytes)
    let exported = []
    for await (let file of provider.export(ref, ['file.bin'])) {
      exported.push(file)
    }
    assertEquals(exported, [{ path: 'file.bin', bytes }])
    await assertRejects(async () => {
      for await (
        let _file of provider.export(ref, ['../elsewhere'])
      ) { /* must refuse */ }
    })
  } finally {
    await provider.release(ref)
    await Deno.remove(dir, { recursive: true })
  }
})

test('commit preparation is explicit, reused on retry and must finish before request answers', async () => {
  let dir = await Deno.makeTempDir()
  let g = tracked()
  let ref = { id: crypto.randomUUID(), from: 'commit' }
  let calls = 0
  let provider = processProvider(g, {
    dir,
    prepare: async (from, machine) => {
      calls++
      await machine.write('from.txt', from)
      if (calls == 1) throw new Error('interrupted preparation')
    },
  })
  try {
    await assertRejects(() => processProvider(g, { dir }).request!(ref))
    await assertRejects(() =>
      provider.request!({ ...ref, image: 'unsupported' })
    )
    await assertRejects(() => provider.request!({ id: '../escape' }))
    await assertRejects(
      () => provider.request!(ref),
      Error,
      'interrupted preparation',
    )
    let { machine } = await provider.request!(ref)
    assertEquals(await machine.read('from.txt'), 'commit')
    await provider.request!(ref)
    assertEquals(calls, 2)
    await assertRejects(() => provider.request!({ ...ref, from: 'different' }))
  } finally {
    await provider.release(ref)
    await Deno.remove(dir, { recursive: true })
  }
})

test('release stops a sandbox process but not another sandbox process', async () => {
  let dir = await Deno.makeTempDir()
  let provider = processProvider(tracked(), {
    dir,
    processes: { dir: `${dir}/processes`, poll: 5 },
  })
  let a = { id: crypto.randomUUID() }
  let b = { id: crypto.randomUUID() }
  let first = await provider.request!(a)
  let second = await provider.request!(b)
  let tools = (machine: typeof first.machine) => {
    let all = machineTools(machine, { grace: 500 })
    return {
      stop: all.find((t) => t.name == 'stop')!,
      wait: all.find((t) => t.name == 'wait')!,
    }
  }
  let one = await first.machine.start('sleep 30')
  let two = await second.machine.start('sleep 30')
  try {
    await provider.release(a)
    assertMatch(
      await tools(first.machine).wait.run({ process: one, timeout: 2000 }),
      /exited(?: \d+|, code unknown)/,
    )
    assertEquals((await second.machine.look(two))?.exit, undefined)
  } finally {
    await tools(second.machine).stop.run({ process: two })
    await provider.release(a)
    await provider.release(b)
    await Deno.remove(dir, { recursive: true })
  }
})
