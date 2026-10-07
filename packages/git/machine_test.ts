// Machine doors preserve byte streams, release abandoned locks and keep
// checkout mirrors subordinate to accepted graph refs.
import { equal, ok, test, until } from '@yaks/testing'
import { discover, repositoryEid, sync } from './host.ts'
import { machineExec, machineLocked, machineRun } from './machine.ts'
import { acceptPack } from './receive.ts'
import { service } from './service.ts'
import { refAt } from './refs.ts'
import { fixture, git, testMachine } from './testing.ts'
import { exportPack } from './landing.ts'

let dec = new TextDecoder()

test('Machine command transport preserves binary output, whitespace and exit status', async () => {
  let machine = testMachine()
  let out = await machineExec(
    machine,
    'python3 -c \'import sys;sys.stdout.buffer.write(bytes(range(256))*300);sys.stderr.write("  err\\n\\n");sys.exit(7)\'',
  )
  equal(out.code, 7)
  equal(out.ok, false)
  equal(out.out.length, 256 * 300)
  for (let i = 0; i < out.out.length; i++) equal(out.out[i], i % 256)
  equal(dec.decode(out.err), '  err\n\n')
  let text = await machineRun(machine)(['--version'], '/')
  ok(text.ok)
  ok(text.out.endsWith('\n'))
})

test('Machine lock expires when the caller cannot renew and a peer can take it', async () => {
  let dir = await Deno.makeTempDir()
  let machine = testMachine()
  let holder: string | undefined
  let renewing = false
  let broken = {
    ...machine,
    start: async (...args: Parameters<typeof machine.start>) =>
      holder = await machine.start(...args),
    write: async (path: string, text: string) => {
      if (renewing) throw new Error('caller disappeared')
      renewing = true
      await machine.write(path, text)
    },
  }
  try {
    let refused = false
    try {
      await machineLocked(broken, dir + '/lock', async () => {
        await until(async () => !!(await machine.look(holder!))?.exit, {
          timeout: 1500,
        })
      }, 80)
    } catch {
      refused = true
    }
    ok(refused)
    equal(
      await machineLocked(
        machine,
        dir + '/lock',
        () => Promise.resolve('peer'),
        500,
      ),
      'peer',
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('Accepted main sync fast-forwards a clean mirror and preserves dirty/diverged work', async () => {
  let dir = await Deno.makeTempDir()
  let machine = testMachine()
  let { g, bytes } = fixture()
  try {
    await git(dir, 'init', '-q', '-b', 'main')
    await git(dir, 'config', 'user.email', 'sync@example.test')
    await git(dir, 'config', 'user.name', 'Sync')
    await Deno.writeTextFile(dir + '/file', 'one')
    await git(dir, 'add', '.')
    await git(dir, 'commit', '-qm', 'one')
    let one = await git(dir, 'rev-parse', 'HEAD')
    await Deno.writeTextFile(dir + '/file', 'two')
    await git(dir, 'commit', '-qam', 'two')
    let two = await git(dir, 'rev-parse', 'HEAD')
    await discover(g, dir, machine)
    let app = repositoryEid(dir + '/.git')
    await acceptPack({ refs: g, objects: g, bytes }, {
      app,
      old: null,
      commit: two,
      pack: await exportPack(machine, dir, two),
    }, { machine, cwd: dir })
    await git(dir, 'reset', '--hard', one)
    await discover(g, dir, machine)
    equal(
      await refAt(g, app),
      two,
      'checkout observation must not replace acceptance',
    )
    await service({ graph: g, artifacts: bytes })
    equal(
      await git(dir, 'rev-parse', 'HEAD'),
      one,
      'no lent Machine means no checkout IO',
    )
    await service({ graph: g, artifacts: bytes, machines: { local: machine } })
    equal(await sync(g, dir, machine, { bytes }), 'current')
    equal(await git(dir, 'rev-parse', 'HEAD'), two)
    equal(await sync(g, dir, machine, { bytes }), 'current')
    await git(dir, 'reset', '--hard', one)
    await Deno.writeTextFile(dir + '/file', 'dirty')
    equal(await sync(g, dir, machine, { bytes }), 'dirty')
    equal(await Deno.readTextFile(dir + '/file'), 'dirty')
    await git(dir, 'commit', '-qam', 'diverged')
    let divergent = await git(dir, 'rev-parse', 'HEAD')
    equal(await sync(g, dir, machine, { bytes }), 'diverged')
    equal(await git(dir, 'rev-parse', 'HEAD'), divergent)
    equal(await refAt(g, app), two)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
