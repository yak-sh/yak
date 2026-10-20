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
import { CallError } from '@yaks/tools/errors'
import { machineTools } from '@yaks/harness/machine'
import { sandboxProvider } from './bubblewrap.ts'
import { until } from '../process/testing.ts'

let limits = { cpuQuota: 50, memoryMax: 256 * 1024 * 1024, tasksMax: 64 }
let make = async () => {
  let dir = await Deno.makeTempDir({ prefix: 'sb-' })
  let options = { dir, limits }
  let provider = sandboxProvider(options)
  let ref = { id: 'one' }
  let tools = (
    machine: Awaited<
      ReturnType<NonNullable<typeof provider.request>>
    >['workspace'],
  ) => {
    let all = machineTools(machine, { grace: 500 })
    return {
      shell: all.find((t) => t.name == 'shell')!,
      wait: all.find((t) => t.name == 'wait')!,
      stop: all.find((t) => t.name == 'stop')!,
    }
  }
  let cleanup = async () => {
    await provider.dispose(ref)
    await provider.dispose({ id: 'two' })
    await Deno.remove(dir, { recursive: true })
  }
  return { dir, options, provider, ref, tools, cleanup }
}

test('sandbox commands and files see only their own workspace and a read-only system', async () => {
  let { dir, provider, ref, tools, cleanup } = await make()
  try {
    // Even when provider data sits inside a host repository, the namespace
    // must expose neither that repository nor any discovery path to it.
    let initialized = await new Deno.Command('git', {
      args: ['init', '-q', dir],
      stderr: 'piped',
    }).output()
    assertEquals(
      initialized.code,
      0,
      new TextDecoder().decode(initialized.stderr),
    )
    await Deno.writeTextFile(`${dir}/private`, 'host-secret')
    let first = await provider.request!(ref)
    let second = await provider.request!({ id: 'two' })
    assertEquals(first.root, '/workspace')
    await first.workspace.write('src/file', 'first')
    await second.workspace.write('src/file', 'second')
    assertEquals(await first.workspace.read('src/file'), 'first')
    assertEquals(await second.workspace.read('src/file'), 'second')
    // Paths are what the guest sees: the host's private file is not there.
    assertEquals(
      await first.workspace.stat(['src/file', '/workspace', `${dir}/private`]),
      [
        { kind: 'file', canonical: '/workspace/src/file' },
        { kind: 'directory', canonical: '/workspace' },
        { kind: 'missing' },
      ],
    )
    for (let cwd of [undefined, 'src']) {
      assertMatch(
        await tools(first.workspace).shell.run({
          command: 'git rev-parse --show-toplevel',
          cwd,
        }),
        /exited 128\n/,
      )
    }
    assertMatch(
      await tools(first.workspace).shell.run({
        command:
          'git init -q && cd src && test "$(git rev-parse --show-toplevel)" = /workspace && echo own',
      }),
      /exited 0\nown$/,
    )
    assertMatch(
      await tools(first.workspace).shell.run({
        command: 'cat src/file; echo; printf "%s" "$HOME"',
      }),
      /exited 0\nfirst\n\/workspace$/,
    )
    let said = await tools(first.workspace).shell.run({
      command:
        `test ! -e '${dir}/private' && test ! -e '${dir}/two' && test ! -e /run/user && test ! -e /home/yaks && test ! -e /etc && test -z "$DBUS_SESSION_BUS_ADDRESS" && ! touch /usr/t66424-private && echo isolated`,
    })
    assertMatch(said, /exited 0\n[\s\S]*isolated$/)
    await assertRejects(() => first.workspace.read(`${dir}/private`), CallError)
    await assertRejects(() => first.workspace.read('.'), CallError)
    await assertRejects(
      () => first.workspace.write('/usr/t66424-private', 'no'),
      CallError,
    )
    // Export must dereference symlinks in the guest, not on the host.
    await tools(first.workspace).shell.run({
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
    let network = await tools(first.workspace).shell.run({
      command: 'exec 3<>/dev/tcp/1.1.1.1/80',
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
    let id = await first.workspace.start('sleep 30')
    let proc = await first.workspace.look(id)
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
    let second = await first.workspace.start('sleep 30')
    let pid = (await first.workspace.look(second))?.pid
    assert(pid)
    assertEquals(
      (await Deno.readTextFile(`/proc/${pid}/cgroup`)).trim().slice(3),
      path,
    )
    // Reopening does not reset a sandbox's limits or lose its running commands.
    let reopened = await sandboxProvider(options).connect(ref)
    assertEquals((await reopened.workspace.look(id))?.exit, undefined)
    await tools(reopened.workspace).stop.run({ process: id })
    await tools(reopened.workspace).stop.run({ process: second })
    await assertRejects(
      () =>
        sandboxProvider({ ...options, limits: { ...limits, cpuQuota: 100 } })
          .connect(ref),
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
      JSON.stringify(new URL('./bubblewrap.ts', import.meta.url).href)
    };
let p = sandboxProvider(${JSON.stringify(options)});
let {workspace: machine} = await p.request(${JSON.stringify(ref)});
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
    let recovered = await sandboxProvider(options).connect(ref)
    assertEquals(await recovered.workspace.receipt!(call), id)
    assertEquals(
      await recovered.workspace.start('echo twice >> started', undefined, call),
      id,
    )
    await until(
      async () => (await recovered.workspace.read('started')).trim() == 'once',
      'command started',
    )
    assertEquals((await recovered.workspace.look(id))?.exit, undefined)
    assertMatch(
      await tools(recovered.workspace).stop.run({ process: id }),
      /exited \d+/,
    )
    assertEquals(await recovered.workspace.read('started'), 'once\n')
    assertEquals(await recovered.workspace.receipt!('missing'), undefined)
    assertEquals(await recovered.workspace.look('missing'), null)
    let done = await recovered.workspace.start(
      'printf "out\\n"; printf "err\\n" >&2; exit 7',
    )
    assertMatch(
      await tools(recovered.workspace).wait.run({ process: done }),
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
    await first.workspace.write('kept', 'yes')
    let one = await first.workspace.start(
      'trap "" TERM; echo ready; sleep 30 & wait',
    )
    let two = await second.workspace.start('sleep 30')
    let pid = (await first.workspace.look(one))?.pid
    assert(pid)
    let path = (await Deno.readTextFile(`/proc/${pid}/cgroup`)).trim().slice(3)
    let unit = path.split('/').at(-1)!
    // A scope stop must end the namespace even if its command ignores TERM.
    // Wait for the trap so this also covers shutdown after namespace setup.
    await until(
      async () => (await first.workspace.tail(one, 1))[0] == 'ready',
      'command ignores TERM',
    )
    let result = await new Deno.Command('/usr/bin/systemctl', {
      args: ['--user', 'stop', unit],
    }).output()
    assertEquals(result.code, 0)
    let reopened = await sandboxProvider(options).connect(ref)
    assertEquals(await reopened.workspace.read('kept'), 'yes')
    assertEquals((await reopened.workspace.look(one))?.exit, { code: null })
    let again = await reopened.workspace.start('sleep 30 & wait')
    let againPid = (await reopened.workspace.look(again))?.pid
    assert(againPid)
    let againPath = (await Deno.readTextFile(`/proc/${againPid}/cgroup`)).trim()
      .slice(3)
    await provider.dispose(ref)
    await provider.dispose(ref)
    await assertRejects(() =>
      Deno.readTextFile(`/sys/fs/cgroup${againPath}/cgroup.procs`)
    )
    await assertRejects(() => provider.connect(ref), Error, 'disposed')
    await assertRejects(() => provider.request!(ref), Error, 'disposed')
    assertEquals((await second.workspace.look(two))?.exit, undefined)
    await tools(second.workspace).stop.run({ process: two })
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
      () => provider.connect(ref),
      Error,
      'preparation incomplete',
    )
    let { workspace: machine } = await provider.request!({
      ...ref,
      from: 'commit',
    })
    assertEquals(await machine.read('from'), 'commit')
    await provider.request!({ ...ref, from: 'commit' })
    assertEquals(calls, 2)
    await assertRejects(() => provider.request!({ ...ref, from: 'other' }))
    await assertRejects(() => provider.request!({ ...ref, image: 'ubuntu' }))
    await assertRejects(() => provider.request!({ id: '../escape' }))
    await assertRejects(() => provider.connect({ ...ref, address: '/tmp' }))
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
      a.workspace.start(
        'echo once >> started; trap "" TERM; sleep 30 & wait',
        undefined,
        'same-call',
      ),
      b.workspace.start('echo twice >> started', undefined, 'same-call'),
    ])
    assertEquals(one, two)
    await until(async () => {
      try {
        return (await b.workspace.read('started')).trim() == 'once'
      } catch {
        return false
      }
    }, 'one launch')
    let pid = (await a.workspace.look(one))?.pid
    assert(pid)
    let cgroup = (await Deno.readTextFile(`/proc/${pid}/cgroup`)).trim().slice(
      3,
    )
    await provider.dispose(ref)
    await assertRejects(() => Deno.stat(`/sys/fs/cgroup${cgroup}`))
  } finally {
    await cleanup()
  }
})
