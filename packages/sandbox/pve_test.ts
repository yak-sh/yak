// A controllable pct executable exercises real host locks and receipt scripts.
// It never connects to PVE or allocates containers; all files are fixture-local.
import { equal, test, throws } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { machineDoc } from '@yaks/machine/vocab'
import { processDoc } from '@yaks/process'
import { pveClones } from './pve.ts'

let vocab = loadVocab([kernelDoc, machineDoc, processDoc])
let g = graph({ storage: ram(vocab), vocab })
let rejected = async (fn: () => unknown, message: string) => {
  let error = await throws(fn, message)
  return error instanceof Error ? error.message.trim() : String(error)
}
let dir = await Deno.makeTempDir({ prefix: 'sandbox-pve-' })
try {
  await Deno.mkdir(dir + '/bin')
  await Deno.mkdir(dir + '/boxes')
  await Deno.writeTextFile(
    dir + '/bin/pct',
    `#!/usr/bin/env python3
import os, sys, pathlib, subprocess, shutil, json
home = pathlib.Path(os.environ['FIXTURE'])
a = sys.argv[1:]
with (home / 'acts').open('a') as f: f.write(json.dumps(a) + '\\n')
cmd = a[0]
if sys.stdin.read():
    print('fixture-pct-consumed-control-stdin', file=sys.stderr)
    sys.exit(41)
if (home / ('fail-' + cmd)).exists():
    print('fixture-' + cmd + '-failed', file=sys.stderr)
    sys.exit(23)
if cmd == 'list':
    print('VMID Status Lock Name')
    for p in (home / 'boxes').iterdir(): print(p.name, 'stopped - fixture')
elif cmd == 'config':
    if a[1] == '900':
        print('template: 1')
        storage = 'other-storage' if (home / 'wrong-storage').exists() else 'test-storage'
        print('rootfs: ' + storage + ':base-900-disk-0,size=8G')
    else:
        p = home / 'boxes' / a[1]
        print('description: ' + (p / 'token').read_text())
        if (p / 'locked').exists(): print('lock: backup')
elif cmd == 'clone':
    assert a[1] == '900' and a[3:5] == ['--full', '0']
    assert a[5] == '--description'
    assert '--storage' not in a
    p = home / 'boxes' / a[2]
    p.mkdir()
    (p / 'token').write_text(a[6])
    (p / 'status').write_text('stopped')
    if (home / 'interrupt-clone').exists():
        print('fixture-clone-interrupted', file=sys.stderr)
        sys.exit(24)
elif cmd == 'status': print('status: ' + (home / 'boxes' / a[1] / 'status').read_text())
elif cmd in ['start', 'stop']:
    (home / 'boxes' / a[1] / 'status').write_text('running' if cmd == 'start' else 'stopped')
elif cmd == 'destroy': shutil.rmtree(home / 'boxes' / a[1])
elif cmd == 'exec':
    assert a[2:7] == ['--keep-env', '0', '--', 'bash', '-c']
    p = home / 'boxes' / a[1]
    assert (p / 'status').read_text() == 'running'
    script = a[7].replace('/workspace', str(p / 'workspace'))
    sys.exit(subprocess.run(['bash', '-c', script]).returncode)
else: sys.exit(29)
`,
  )
  await Deno.chmod(dir + '/bin/pct', 0o700)
  let transport = {
    execute: async (script: string) => {
      let result = await new Deno.Command('bash', {
        args: ['-s'],
        stdin: 'piped',
        env: { FIXTURE: dir, PATH: dir + '/bin:' + Deno.env.get('PATH') },
        stdout: 'piped',
        stderr: 'piped',
      }).spawn()
      let input = result.stdin.getWriter()
      await input.write(new TextEncoder().encode(script))
      await input.close()
      let output = await result.output()
      if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr))
      }
      return new TextDecoder().decode(output.stdout)
    },
  }
  let base = {
    transport,
    state: dir + '/receipts',
    template: 900,
    storage: 'test-storage',
    vmidRange: [1000, 1000] as const,
  }
  let ref = { id: 'sandbox-A' }
  await g.apply([{
    entity: { eid: ref.id },
    workspace: { root: '/workspace' },
  }])
  let preparations = 0
  let options = {
    ...base,
    prepare: async (
      _from: string,
      workspace: import('@yaks/machine').Workspace,
    ) => {
      preparations++
      await workspace.write('source', 'initial commit')
    },
  }
  let provider = pveClones(g, options)
  await Deno.writeTextFile(dir + '/wrong-storage', '')
  let wrongStorage = await rejected(
    () => provider.request!(ref),
    'PVE linked clone requires every template volume on configured storage',
  )
  await Deno.remove(dir + '/wrong-storage')
  let first = await provider.request!({ ...ref, from: 'commit' })
  let second = await pveClones(g, options).request!({ ...ref, from: 'commit' })
  equal(await second.workspace.read('source'), 'initial commit')
  let process = await first.workspace.start('true', undefined, 'pve-call')
  let reconnected = await pveClones(g, options).connect(ref)
  let receipt = await reconnected.workspace.receipt!('pve-call')
  let [processRow] = await g.get([process])
  let changed = await rejected(
    () => provider.request!({ ...ref, from: 'different' }),
    'PVE request changed',
  )
  let image = await rejected(
    () => provider.request!({ ...ref, image: 'debian' }),
    'PVE image is unsupported',
  )
  let unprepared = await rejected(() =>
    pveClones(g, base).request!(
      { id: 'other', from: 'commit' },
    ), 'PVE commit preparation is not configured')
  let collision = await rejected(() =>
    provider.request!(
      { id: 'sandbox-B', from: 'commit' },
    ), 'PVE VMID is not owned by this sandbox')
  let wrongAddress = await rejected(
    () => provider.dispose({ ...ref, address: '1001' }),
    'PVE address does not match',
  )
  let box = dir + '/boxes/1000'
  await Deno.writeFile(box + '/workspace/binary', new Uint8Array([0, 255, 42]))
  let files = []
  for await (let file of provider.export(ref, ['binary'])) files.push(file)
  await Deno.symlink('/etc/passwd', box + '/workspace/link')
  await Deno.symlink(box, box + '/workspace/outside')
  let escapes = []
  for (let path of ['../token', '/etc/passwd', 'link', 'outside/token']) {
    escapes.push(
      await throws(async () => {
        for await (let _ of provider.export(ref, [path])) { /* consume */ }
      }, /relative|OSError|NotADirectoryError/),
    )
  }
  await Deno.writeTextFile(dir + '/fail-list', '')
  let offline = await rejected(
    () => provider.request!({ ...ref, from: 'commit' }),
    'fixture-list-failed',
  )
  let offlineDispose = await rejected(
    () => provider.dispose(ref),
    'fixture-list-failed',
  )
  await Deno.remove(dir + '/fail-list')
  let token = await Deno.readTextFile(box + '/token')
  await Deno.writeTextFile(box + '/token', 'foreign')
  let foreignConnect = await rejected(
    () => provider.connect(ref),
    'PVE container ownership changed',
  )
  let foreignDispose = await rejected(
    () => provider.dispose(ref),
    'PVE container ownership changed',
  )
  let staleRead = await rejected(
    () => first.workspace.read('source'),
    'PVE container ownership changed',
  )
  let staleWrite = await rejected(
    () => first.workspace.write('source', 'wrong'),
    'PVE container ownership changed',
  )
  let retainedSource = await Deno.readTextFile(box + '/workspace/source')
  let foreignRetained = await Deno.readTextFile(box + '/token')
  await Deno.writeTextFile(box + '/token', token)
  await Deno.writeTextFile(box + '/locked', '')
  let locked = await rejected(
    () => provider.dispose(ref),
    'PVE container is locked',
  )
  await Deno.remove(box + '/locked')
  await Deno.writeTextFile(dir + '/fail-destroy', '')
  let failedDestroy = await rejected(
    () => provider.dispose(ref),
    'fixture-destroy-failed',
  )
  let stopped = await rejected(
    () => provider.connect(ref),
    'PVE sandbox is not running',
  )
  await Deno.remove(dir + '/fail-destroy')
  await provider.dispose(ref)
  await provider.dispose(ref)
  let released = await rejected(
    () => provider.request!({ ...ref, from: 'commit' }),
    'PVE sandbox was disposed',
  )

  // A clone that exists after a lost response is still ambiguous. Neither
  // request nor connect may adopt it, but the token permits safe cleanup.
  let ambiguousOptions = { ...base, state: dir + '/ambiguous' }
  let ambiguous = pveClones(g, ambiguousOptions)
  await Deno.writeTextFile(dir + '/interrupt-clone', '')
  let interrupted = await rejected(
    () => ambiguous.request!(ref),
    'fixture-clone-interrupted',
  )
  await Deno.remove(dir + '/interrupt-clone')
  let retry = await rejected(
    () => pveClones(g, ambiguousOptions).request!(ref),
    'PVE clone creation is incomplete',
  )
  let partialConnect = await rejected(
    () => ambiguous.connect(ref),
    'PVE clone creation is incomplete',
  )
  await ambiguous.dispose(ref)

  // A confirmed clone that disappears must not be recreated by another call.
  let missingOptions = { ...base, state: dir + '/missing' }
  let missing = pveClones(g, missingOptions)
  await missing.request!(ref)
  await Deno.remove(box, { recursive: true })
  let missingConnect = await rejected(
    () => missing.connect(ref),
    'PVE clone is missing',
  )
  let missingRetry = await rejected(
    () => missing.request!(ref),
    'PVE clone is missing',
  )
  await missing.dispose(ref)
  await missing.dispose(ref)

  // Preparation failure is retryable only through request, not connect.
  let tries = 0
  let preparationOptions = {
    ...base,
    state: dir + '/prepare',
    prepare: () => {
      if (++tries == 1) return Promise.reject(new Error('prepare interrupted'))
      return Promise.resolve()
    },
  }
  let preparing = pveClones(g, preparationOptions)
  let preparationFailure = await rejected(
    () => preparing.request!({ ...ref, from: 'commit' }),
    'prepare interrupted',
  )
  let prematureConnect = await rejected(
    () => preparing.connect(ref),
    'PVE sandbox preparation is incomplete',
  )
  await pveClones(g, preparationOptions).request!({ ...ref, from: 'commit' })
  await preparing.dispose(ref)

  // A wholly foreign pre-existing VMID is neither adopted nor destroyed.
  await Deno.mkdir(box)
  await Deno.writeTextFile(box + '/token', 'unrelated-container')
  await Deno.writeTextFile(box + '/status', 'stopped')
  let foreign = pveClones(g, { ...base, state: dir + '/foreign' })
  let preexisting = await rejected(
    () => foreign.request!(ref),
    'PVE VMID already exists without ownership',
  )
  let unownedDispose = await rejected(
    () => foreign.dispose(ref),
    'PVE VMID is not owned by this sandbox',
  )
  let untouched = await Deno.readTextFile(box + '/token')

  let acts = (await Deno.readTextFile(dir + '/acts')).trim().split('\n').map((
    s,
  ) => JSON.parse(s) as string[])
  test('PVE retries reconnect to one prepared clone on the selected computer', () => {
    equal(first.address, second.address)
    equal(first.root, '/workspace')
    equal(
      wrongStorage,
      'PVE linked clone requires every template volume on configured storage',
    )
    equal(preparations, 1)
    equal(receipt, process)
    equal((processRow.process as Comp)?.workspace, ref.id)
    equal(acts.filter((a) => a[0] == 'clone').length, 4)
  })
  test('PVE refuses conflicting requests and never adopts another container', () => {
    equal(
      [
        changed,
        image,
        unprepared,
        collision,
        wrongAddress,
        foreignConnect,
        foreignDispose,
        preexisting,
        unownedDispose,
        locked,
      ].every(Boolean),
      true,
    )
    equal(
      [staleRead, staleWrite],
      Array(2).fill('PVE container ownership changed'),
    )
    equal(retainedSource, 'initial commit')
    equal(foreignRetained, 'foreign')
    equal(untouched, 'unrelated-container')
  })
  test('PVE propagates control failures and retains retryable disposal receipts', () => {
    equal(
      [offline, offlineDispose, failedDestroy, stopped, released].every(
        Boolean,
      ),
      true,
    )
    equal(acts.filter((a) => a[0] == 'destroy').length, 4)
  })
  test('PVE missing or interrupted clones never silently recreate', () => {
    equal(
      [interrupted, retry, partialConnect, missingConnect, missingRetry].every(
        Boolean,
      ),
      true,
    )
  })
  test('PVE preparation must complete before public connection', () => {
    equal([preparationFailure, prematureConnect].every(Boolean), true)
    equal(tries, 2)
  })
  test('PVE export reads binary files inside LXC and rejects symlink escapes', () => {
    equal(files, [{ path: 'binary', bytes: new Uint8Array([0, 255, 42]) }])
    equal(escapes.every(Boolean), true)
  })
} finally {
  await Deno.remove(dir, { recursive: true })
}

test('PVE has no implicit template, storage or VMID pool', async () => {
  let transport = {
    execute: () => Promise.reject(new Error('must not execute')),
  }
  let options = {
    transport,
    state: '/private/state',
    template: 900,
    storage: 'pool',
    vmidRange: [1000, 1001] as const,
  }
  await throws(() => pveClones(g, { ...options, storage: '' }))
  await throws(() => pveClones(g, { ...options, vmidRange: [900, 1000] }))
  await throws(() => pveClones(g, { ...options, state: '/state/../other' }))
  await throws(() =>
    pveClones(g, options).connect({ id: 'sandbox', address: 'wrong' })
  )
})
