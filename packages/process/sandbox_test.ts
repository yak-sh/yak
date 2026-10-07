// Actual namespaces and cgroup controllers, not an argument mock: sandbox
// isolation, aggregate limits and durable receipts must work on this host.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'
import { test } from '@yaks/testing'
import { machineTools } from '@yaks/harness/machine'
import { sandboxProvider } from '@yaks/process/machine'
import { until } from './testing.ts'

let limits = { cpuQuota: 50, memoryMax: 256 * 1024 * 1024, tasksMax: 64 }
let make = async () => {
  let dir = await Deno.makeTempDir({ prefix: 'sb-' })
  let options = { dir, limits }
  let provider = sandboxProvider(options)
  let ref = { id: 'one' }
  let tools = (
    machine: Awaited<
      ReturnType<NonNullable<typeof provider.request>>
    >['machine'],
  ) => {
    let all = machineTools(machine, { grace: 500 })
    return {
      shell: all.find((t) => t.name == 'shell')!,
      wait: all.find((t) => t.name == 'wait')!,
      stop: all.find((t) => t.name == 'stop')!,
    }
  }
  let cleanup = async () => {
    await provider.release(ref)
    await provider.release({ id: 'two' })
    await Deno.remove(dir, { recursive: true })
  }
  return { dir, options, provider, ref, tools, cleanup }
}

test('sandbox commands and files see only their own workspace and a read-only system', async () => {
  let { dir, provider, ref, tools, cleanup } = await make()
  try {
    await Deno.writeTextFile(`${dir}/private`, 'host-secret')
    let first = await provider.request!(ref)
    let second = await provider.request!({ id: 'two' })
    assertEquals(first.cwd, '/workspace')
    await first.machine.write('src/file', 'first')
    await second.machine.write('src/file', 'second')
    assertEquals(await first.machine.read('src/file'), 'first')
    assertEquals(await second.machine.read('src/file'), 'second')
    assertMatch(
      await tools(first.machine).shell.run({
        command: 'cat src/file; echo; printf "%s" "$HOME"',
      }),
      /exited 0\nfirst\n\/workspace$/,
    )
    let said = await tools(first.machine).shell.run({
      command:
        `test ! -e '${dir}/private' && test ! -e '${dir}/two' && test ! -e /run/user && test ! -e /home/yaks && test ! -e /etc && test -z "$DBUS_SESSION_BUS_ADDRESS" && ! touch /usr/t66424-private && echo isolated`,
    })
    assertMatch(said, /exited 0\n[\s\S]*isolated$/)
    await assertRejects(() => first.machine.read(`${dir}/private`))
    await assertRejects(() => first.machine.write('/usr/t66424-private', 'no'))
    // Export must dereference symlinks in the guest, not on the host.
    await tools(first.machine).shell.run({
      command:
        `ln -s '${dir}/private' escape; ln -s /usr/bin/bash system-link; printf '\\000\\377\\177' > binary`,
    })
    await assertRejects(async () => {
      for await (let _ of provider.export(ref, ['escape'])) { /* refused */ }
    })
    await assertRejects(async () => {
      for await (let _ of provider.export(ref, ['system-link'])) {
        /* refused */
      }
    })
    let files = []
    for await (let file of provider.export(ref, ['binary'])) files.push(file)
    assertEquals(files, [{
      path: 'binary',
      bytes: new Uint8Array([0, 255, 127]),
    }])
    await assertRejects(async () => {
      for await (let _ of provider.export(ref, ['../private'])) {
        /* refused */
      }
    })
    let network = await tools(first.machine).shell.run({
      command:
        '/usr/bin/python3 -c "import socket; s=socket.socket(); s.settimeout(0.1); s.connect((\'1.1.1.1\', 80))"',
    })
    assertMatch(network, /exited 1/)
  } finally {
    await cleanup()
  }
})

test('sandbox scope enforces aggregate CPU, memory and task limits for every command', async () => {
  let { options, provider, ref, tools, cleanup } = await make()
  try {
    let first = await provider.request!(ref)
    // Find the actual scope from a running command's host PID. Bubblewrap
    // shares no cgroup fs with the guest; read its host cgroup from here.
    let id = await first.machine.start('sleep 30')
    let proc = await first.machine.look(id)
    assert(proc?.pid)
    let path = (await Deno.readTextFile(`/proc/${proc.pid}/cgroup`)).trim()
      .slice(3)
    let base = `/sys/fs/cgroup${path}`
    let [quota, period] = (await Deno.readTextFile(`${base}/cpu.max`)).trim()
      .split(' ').map(Number)
    assertEquals(quota / period, 0.5)
    assertEquals(
      (await Deno.readTextFile(`${base}/memory.max`)).trim(),
      String(limits.memoryMax),
    )
    assertEquals(
      (await Deno.readTextFile(`${base}/memory.swap.max`)).trim(),
      '0',
    )
    assertEquals(
      (await Deno.readTextFile(`${base}/pids.max`)).trim(),
      String(limits.tasksMax),
    )
    let second = await first.machine.start('sleep 30')
    let pid = (await first.machine.look(second))?.pid
    assert(pid)
    assertEquals(
      (await Deno.readTextFile(`/proc/${pid}/cgroup`)).trim().slice(3),
      path,
    )
    // Reopening does not reset a sandbox's limits or lose its running commands.
    let reopened = await sandboxProvider(options).wake(ref)
    assertEquals((await reopened.machine.look(id))?.exit, undefined)
    await tools(reopened.machine).stop.run({ process: id })
    await tools(reopened.machine).stop.run({ process: second })
    await assertRejects(
      () =>
        sandboxProvider({ ...options, limits: { ...limits, cpuQuota: 100 } })
          .wake(ref),
      Error,
      'different provider limits',
    )
  } finally {
    await cleanup()
  }
})

test('sandbox commands outlive a requesting host and recover durable calls without launching twice', async () => {
  let { options, ref, tools, cleanup } = await make()
  let call = crypto.randomUUID()
  try {
    let program = `import { sandboxProvider } from ${
      JSON.stringify(new URL('./sandbox.ts', import.meta.url).href)
    };
let p = sandboxProvider(${JSON.stringify(options)});
let {machine} = await p.request(${JSON.stringify(ref)});
console.log(await machine.start('echo once >> started; sleep 30', undefined, ${
      JSON.stringify(call)
    }));`
    let child = await new Deno.Command(Deno.execPath(), {
      args: ['eval', program],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    assertEquals(child.code, 0, new TextDecoder().decode(child.stderr))
    let id = new TextDecoder().decode(child.stdout).trim()
    let recovered = await sandboxProvider(options).wake(ref)
    assertEquals(await recovered.machine.receipt!(call), id)
    assertEquals(
      await recovered.machine.start('echo twice >> started', undefined, call),
      id,
    )
    await until(
      async () => (await recovered.machine.read('started')).trim() == 'once',
      'command started',
    )
    assertEquals((await recovered.machine.look(id))?.exit, undefined)
    assertMatch(
      await tools(recovered.machine).stop.run({ process: id }),
      /exited \d+/,
    )
    assertEquals(await recovered.machine.read('started'), 'once\n')
    assertEquals(await recovered.machine.receipt!('missing'), undefined)
    assertEquals(await recovered.machine.look('missing'), null)
    let done = await recovered.machine.start(
      'printf "out\\n"; printf "err\\n" >&2; exit 7',
    )
    assertMatch(
      await tools(recovered.machine).wait.run({ process: done }),
      /exited 7\nout\nerr$/,
    )
  } finally {
    await cleanup()
  }
})

test('release kills descendants, preserves other sandboxes, and wakes a stopped scope with its files', async () => {
  let { options, provider, ref, tools, cleanup } = await make()
  try {
    let first = await provider.request!(ref)
    let second = await provider.request!({ id: 'two' })
    await first.machine.write('kept', 'yes')
    let one = await first.machine.start('sleep 30 & wait')
    let two = await second.machine.start('sleep 30')
    let pid = (await first.machine.look(one))?.pid
    assert(pid)
    let path = (await Deno.readTextFile(`/proc/${pid}/cgroup`)).trim().slice(3)
    let unit = path.split('/').at(-1)!
    let result = await new Deno.Command('/usr/bin/systemctl', {
      args: ['--user', 'stop', unit],
    }).output()
    assertEquals(result.code, 0)
    let reopened = await sandboxProvider(options).wake(ref)
    assertEquals(await reopened.machine.read('kept'), 'yes')
    assertEquals((await reopened.machine.look(one))?.exit, { code: null })
    let again = await reopened.machine.start('sleep 30 & wait')
    let againPid = (await reopened.machine.look(again))?.pid
    assert(againPid)
    let againPath = (await Deno.readTextFile(`/proc/${againPid}/cgroup`)).trim()
      .slice(3)
    await provider.release(ref)
    await provider.release(ref)
    await assertRejects(() =>
      Deno.readTextFile(`/sys/fs/cgroup${againPath}/cgroup.procs`)
    )
    await assertRejects(() => provider.wake(ref), Deno.errors.NotFound)
    assertEquals((await second.machine.look(two))?.exit, undefined)
    await tools(second.machine).stop.run({ process: two })
  } finally {
    await cleanup()
  }
})

test('sandbox commit preparation retries safely and rejects unsupported or incompatible requests', async () => {
  let { options, ref, cleanup } = await make()
  let calls = 0
  let provider = sandboxProvider({
    ...options,
    prepare: async (from, machine) => {
      calls++
      await machine.write('from', from)
      if (calls == 1) throw new Error('interrupted')
    },
  })
  try {
    await assertRejects(
      () => provider.request!({ ...ref, from: 'commit' }),
      Error,
      'interrupted',
    )
    await assertRejects(
      () => provider.wake(ref),
      Error,
      'preparation incomplete',
    )
    let { machine } = await provider.request!({ ...ref, from: 'commit' })
    assertEquals(await machine.read('from'), 'commit')
    await provider.request!({ ...ref, from: 'commit' })
    assertEquals(calls, 2)
    await assertRejects(() => provider.request!({ ...ref, from: 'other' }))
    await assertRejects(() => provider.request!({ ...ref, image: 'ubuntu' }))
    await assertRejects(() => provider.request!({ id: '../escape' }))
    await assertRejects(() => provider.wake({ ...ref, address: '/tmp' }))
    assertThrows(() =>
      sandboxProvider({ ...options, limits: { ...limits, cpuQuota: 0 } })
    )
    assertThrows(() =>
      sandboxProvider({
        ...options,
        limits: { ...limits, memoryMax: Infinity },
      })
    )
    assertThrows(() =>
      sandboxProvider({ ...options, limits: { ...limits, tasksMax: 0 } })
    )
  } finally {
    await cleanup()
  }
})

test('concurrent providers reuse one sandbox and one durable command; release defeats ignored TERM', async () => {
  let { options, provider, ref, cleanup } = await make()
  try {
    let [a, b] = await Promise.all([
      provider.request!(ref),
      sandboxProvider(options).request!(ref),
    ])
    let [one, two] = await Promise.all([
      a.machine.start(
        'echo once >> started; trap "" TERM; sleep 30 & wait',
        undefined,
        'same-call',
      ),
      b.machine.start('echo twice >> started', undefined, 'same-call'),
    ])
    assertEquals(one, two)
    await until(async () => {
      try {
        return (await b.machine.read('started')).trim() == 'once'
      } catch {
        return false
      }
    }, 'one launch')
    let pid = (await a.machine.look(one))?.pid
    assert(pid)
    let cgroup = (await Deno.readTextFile(`/proc/${pid}/cgroup`)).trim().slice(
      3,
    )
    await provider.release(ref)
    await assertRejects(() => Deno.stat(`/sys/fs/cgroup${cgroup}`))
  } finally {
    await cleanup()
  }
})
