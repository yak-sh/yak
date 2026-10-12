// Source paths follow a private runtime; data and other checkouts do not.
import { equal, test, until } from '@yaks/testing'
import { runtimePath, runtimeStack } from './runtime.ts'

test('a runtime remaps source paths without moving neighboring checkouts or data', () => {
  let path = (spec: string) =>
    runtimePath(spec, 'file:///src', 'file:///private')
  equal(
    path('file:///src/packages/tool/tools.ts'),
    'file:///private/packages/tool/tools.ts',
  )
  equal(path('file:///src-other/tool.ts'), 'file:///src-other/tool.ts')
  equal(path('file:///data/yak.db'), 'file:///data/yak.db')
  equal(path('@yaks/task'), '@yaks/task')
  equal(
    runtimeStack(
      'Error\n at file:///private/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
      'file:///src',
      'file:///private',
    ),
    'Error\n at file:///src/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
  )
  equal(
    runtimePath('file:///src/tool.ts', undefined, undefined),
    'file:///src/tool.ts',
  )
})

// A launcher killed outright forwards nothing; its child, in a session of its
// own, ends itself rather than hold the port and the graph forever.
test('a pinned child ends once its launcher is gone', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-orphan-' })
  let runtime = new URL('./runtime.ts', import.meta.url).href
  let config = new URL('../../deno.json', import.meta.url).pathname
  let code = `import { orphaned } from '${runtime}'
orphaned(Deno.ppid, 20)
Deno.writeTextFileSync(Deno.args[0], String(Deno.pid))
setTimeout(() => {}, 30000)`
  let child =
    `setsid '${Deno.execPath()}' eval --config '${config}' "$0" '${dir}/pid' &`
  let launcher = new Deno.Command('sh', {
    args: ['-c', `${child}\nexec sleep 30`, code],
  }).spawn()
  let alive = (pid: number) => {
    try {
      Deno.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  let pid = 0
  try {
    await until(async () => {
      pid = Number(await Deno.readTextFile(`${dir}/pid`).catch(() => '0'))
      return pid > 0
    }, { timeout: 10000, label: 'child started' })
    launcher.kill('SIGKILL')
    await launcher.status
    await until(() => !alive(pid), { timeout: 5000, label: 'child ended' })
  } finally {
    if (pid && alive(pid)) Deno.kill(pid, 'SIGKILL')
    try {
      launcher.kill('SIGKILL')
    } catch { /* ended */ }
    await launcher.status
    await Deno.remove(dir, { recursive: true })
  }
})
