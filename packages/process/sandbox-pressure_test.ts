// Exercise controller enforcement under load, not just systemd properties.
// The pressure is contained in one disposable scope and always reaped.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { sandboxProvider } from '@yaks/process/machine'
import { until } from './testing.ts'

let limits = { cpuQuota: 50, memoryMax: 48 * 1024 * 1024, tasksMax: 32 }

test('sandbox controllers throttle CPU, refuse extra tasks and contain memory exhaustion', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'sp-' })
  let options = { dir, limits }
  let provider = sandboxProvider(options)
  let ref = { id: 'load' }
  try {
    let { machine } = await provider.request!(ref)
    let burn = await machine.start('while :; do :; done')
    let pid = (await machine.look(burn))?.pid
    assert(pid)
    let cgroup = (await Deno.readTextFile(`/proc/${pid}/cgroup`)).trim().slice(
      3,
    )
    let base = `/sys/fs/cgroup${cgroup}`
    await until(
      async () => {
        let stat = await Deno.readTextFile(`${base}/cpu.stat`)
        return Number(stat.match(/^nr_throttled (\d+)$/m)?.[1]) > 0
      },
      'CPU controller throttles',
      5000,
    )
    await machine.kill(burn, 'SIGKILL')
    await until(async () => (await machine.look(burn))?.exit, 'burn ended')

    let fork = await machine.start(`/usr/bin/python3 - <<'PY'
import os, signal, time
children = []
try:
    for i in range(128):
        pid = os.fork()
        if pid == 0:
            time.sleep(30)
            os._exit(0)
        children.append(pid)
except BlockingIOError:
    print('limited', flush=True)
finally:
    for pid in children:
        os.kill(pid, signal.SIGKILL)
    for pid in children:
        os.waitpid(pid, 0)
PY`)
    await until(
      async () => (await machine.look(fork))?.exit,
      'task pressure ended',
    )
    assertEquals((await machine.look(fork))?.exit?.code, 0)
    assertEquals(await machine.tail(fork, 1), ['limited'])
    assert(
      Number(
        (await Deno.readTextFile(`${base}/pids.events`)).match(/^max (\d+)$/m)
          ?.[1],
      ) > 0,
    )

    await machine.write('survives', 'workspace')
    let oom = await machine.start(
      '/usr/bin/python3 -c "x=bytearray(512*1024*1024)"',
      undefined,
      'oom',
    )
    // OOMPolicy=kill ends the whole scope, including the supervisor. Observe
    // cgroup disappearance rather than asking its dead socket to poll itself.
    await until(
      async () => {
        try {
          await Deno.stat(`${base}/cgroup.procs`)
          return false
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e
          return true
        }
      },
      'OOM scope ended',
      10000,
    )
    await assertRejects(() => machine.read('survives'))
    let restored = await sandboxProvider(options).wake(ref)
    assertEquals(await restored.machine.read('survives'), 'workspace')
    assertEquals(await restored.machine.receipt!('oom'), oom)
    assertEquals((await restored.machine.look(oom))?.exit, { code: null })
  } finally {
    await provider.release(ref)
    await Deno.remove(dir, { recursive: true })
  }
})
