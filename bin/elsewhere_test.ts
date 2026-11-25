// A run elsewhere starts from this checkout exactly as it stands, on a machine
// that fetches what it lacks; and anything short of a started run leaves the
// caller to run it here.
import { equal, ok, test, throws } from '@yaks/testing'
import { localConnector } from '@yaks/machine/connectors'
import {
  elsewhere,
  type Git,
  git,
  hasRoom,
  machine,
  prepare,
  ROOM,
  work,
} from './elsewhere.ts'

let root = await Deno.makeTempDir()
let at = (dir: string): Git => (args, env) => git(['-C', dir, ...args], env)
let say = (dir: string, ...args: string[]) =>
  at(dir)(args).then((b) => new TextDecoder().decode(b).trim())
let put = (path: string, data: string | Uint8Array) =>
  typeof data == 'string'
    ? Deno.writeTextFile(path, data)
    : Deno.writeFile(path, data)

// Origin, the machine's bare clone of it, and a checkout of it with work of
// every kind on a commit the machine's clone has not fetched.
let origin = `${root}/origin`, home = `${root}/home`, local = `${root}/local`
await git(['init', '-q', '-b', 'main', origin])
await Deno.mkdir(`${origin}/bin`)
await put(`${origin}/bin/workspace-dependencies`, '#!/bin/sh\necho installed\n')
await Deno.chmod(`${origin}/bin/workspace-dependencies`, 0o755)
await put(`${origin}/kept.txt`, 'one\n')
await put(`${origin}/gone.txt`, 'gone\n')
await say(origin, 'add', '-A')
await say(origin, 'commit', '-qm', 'first')
await Deno.mkdir(`${home}/runs`, { recursive: true })
await git(['clone', '-q', '--bare', origin, `${home}/repo.git`])
await say(
  `${home}/repo.git`,
  'config',
  'remote.origin.fetch',
  '+refs/heads/*:refs/heads/*',
)
await put(`${origin}/later.txt`, 'later\n')
await say(origin, 'add', '-A')
await say(origin, 'commit', '-qm', 'later')
await git(['clone', '-q', origin, local])
let from = await say(local, 'rev-parse', 'HEAD')
await say(local, 'switch', '-qc', 'topic')
await put(`${local}/committed.txt`, 'committed\n')
await say(local, 'add', '-A')
await say(local, 'commit', '-qm', 'topic')
await put(`${local}/staged.txt`, 'staged\n')
await say(local, 'add', 'staged.txt')
await put(`${local}/kept.txt`, 'one\ntwo\n')
await Deno.remove(`${local}/gone.txt`)
let binary = Uint8Array.of(0, 159, 146, 150, 255, 10)
await put(`${local}/untracked.bin`, binary)
let status = await say(local, 'status', '--porcelain')

// The machine: bash with the temporary home as its HOME.
let machineHere = await localConnector(async (command, args, input) => {
  let child = new Deno.Command(command, {
    args,
    env: { HOME: home },
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(input))
  await writer.close()
  let { success, stdout, stderr } = await child.output()
  let text = (b: Uint8Array) => new TextDecoder().decode(b)
  if (!success) throw new Error(text(stderr))
  return text(stdout)
}).connect('local://')

let diff = await work(from, at(local))
let run = (await machineHere.execute(prepare('r1', from, diff))).trim()
let tree = `${run}/tree`
let read = (name: string) => Deno.readTextFile(`${tree}/${name}`)

test('a run there starts from the checkout as it stands, fetching the commit it builds on', async () => {
  equal(run, `${home}/runs/r1`)
  equal(await say(tree, 'rev-parse', 'HEAD'), from)
  equal(
    await Promise.all(['committed.txt', 'staged.txt', 'kept.txt'].map(read)),
    ['committed\n', 'staged\n', 'one\ntwo\n'],
  )
  equal(await Deno.readFile(`${tree}/untracked.bin`), binary)
  await throws(() => Deno.stat(`${tree}/gone.txt`))
  equal(await Deno.readTextFile(`${run}/dependencies.log`), 'installed\n')
})

test('making the run there leaves the checkout and its index as they were', async () => {
  equal(await say(local, 'status', '--porcelain'), status)
})

test('a commit the machine cannot fetch refuses the run', async () => {
  let missing = 'f'.repeat(40)
  await throws(() => machineHere.execute(prepare('r2', missing, diff)))
})

let config = (named?: string): Git => (args) =>
  args[0] == 'config' && named != undefined
    ? Promise.resolve(new TextEncoder().encode(named + '\n'))
    : Promise.reject(new Error('no such key'))

test('YAK_MACHINE names the machine, even as here, before the clone does', async () => {
  let env = (value?: string) => () => value
  equal(await machine(config('ssh://a'), env()), 'ssh://a')
  equal(await machine(config('ssh://a'), env('ssh://b')), 'ssh://b')
  equal(await machine(config('ssh://a'), env('')), undefined)
  equal(await machine(config(), env()), undefined)
})

test('scoped work can start beside recent runs while measured memory has room', async () => {
  let memory = 'MemAvailable: 9437184 kB\nsome avg10=0.00\n'
  let counts = (reading: string) => ({
    execute: (script: string) =>
      Promise.resolve(reading + (script == ROOM ? '2\n' : '')),
  })
  equal(await hasRoom(counts(memory), true), false)
  equal(await hasRoom(counts(memory), false), true)
  equal(
    await hasRoom(counts(memory.replace('9437184', '3145728')), false),
    false,
  )
  equal(await hasRoom(counts(memory.replace('0.00', '25.00')), false), false)
})

// Anything short of a started run is said once, and leaves the run here. The
// machine has room, whatever this one has.
let roomy = {
  execute: (script: string) =>
    script == ROOM
      ? Promise.resolve('MemAvailable: 99999999 kB\nsome avg10=0.00\n0\n')
      : machineHere.execute(script),
}
let fallback = async (connect: () => Promise<typeof roomy>) => {
  let said: string[] = []
  let code = await elsewhere(['true'], {
    // The topic's own commit, which origin never had.
    from: () => say(local, 'rev-parse', 'HEAD'),
    named: () => Promise.resolve('local://'),
    run: at(local),
    connect,
    say: (line) => said.push(line),
  })
  return { code, said }
}

test('a machine that cannot be reached, or cannot take the work, leaves the run here', async () => {
  for (
    let connect of [
      () => Promise.reject(new Error('unreachable')),
      () => Promise.resolve(roomy),
    ]
  ) {
    let { code, said } = await fallback(connect)
    equal(code, undefined)
    equal(said.length, 1)
    ok(said[0].endsWith('running here'), said[0])
  }
})
