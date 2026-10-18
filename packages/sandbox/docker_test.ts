// Real control and exec scripts run against a fixture-local sbx executable.
// No Docker daemon or real sandbox is reached by this suite.
import { equal, test, throws } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { machineDoc } from '@yaks/machine/vocab'
import { processDoc } from '@yaks/process'
import { dockerSandboxes } from './docker.ts'
import { exportPath } from './provider.ts'

let vocab = loadVocab([kernelDoc, machineDoc, processDoc])
let g = graph({ storage: ram(vocab), vocab })
let dir = await Deno.makeTempDir({ prefix: 'sandbox-docker-' })
let outcome = async (fn: () => unknown) => {
  try {
    await fn()
    return 'unexpected success'
  } catch (e) {
    return e instanceof Error ? e.message.trim() : String(e)
  }
}
try {
  await Deno.mkdir(dir + '/bin')
  await Deno.mkdir(dir + '/boxes')
  await Deno.writeTextFile(
    dir + '/bin/sbx',
    `#!/usr/bin/env python3
import os, sys, json, pathlib, shutil, subprocess
home = pathlib.Path(os.environ['FIXTURE'])
a = sys.argv[1:]
with (home / 'acts').open('a') as f: f.write(json.dumps(a) + '\\n')
cmd = a.pop(0)
if (home / ('fail-' + cmd)).exists():
    print('fixture-' + cmd + '-failed', file=sys.stderr)
    sys.exit(31)
if cmd == 'ls':
    for p in (home / 'boxes').iterdir(): print(p.name)
elif cmd == 'create':
    name = a[a.index('--name') + 1]
    p = home / 'boxes' / name
    p.mkdir()
    env = {}
    for i, arg in enumerate(a):
        if arg == '--env':
            key, value = a[i + 1].split('=', 1)
            env[key] = value
    (p / 'env').write_text(json.dumps(env))
elif cmd == 'exec':
    if a[0] == '-u': a = a[2:]
    name = a.pop(0)
    p = home / 'boxes' / name
    if not p.is_dir(): sys.exit(32)
    env = dict(os.environ)
    env.update(json.loads((p / 'env').read_text()))
    if a[:1] == ['id']: print('1000')
    elif a[:1] == ['chown']: pass
    elif a[:1] == ['printenv']:
        if a[1] not in env: sys.exit(1)
        print(env[a[1]])
    else:
        # Execute the exact bash/base64 pipeline from production. Explicit
        # fixture roots keep all filesystem writes under this test directory.
        sys.exit(subprocess.run(a, env=env).returncode)
elif cmd == 'rm':
    name = a[-1]
    shutil.rmtree(home / 'boxes' / name)
else: sys.exit(39)
`,
  )
  await Deno.chmod(dir + '/bin/sbx', 0o700)
  let transport = {
    execute: async (script: string) => {
      let result = await new Deno.Command('bash', {
        args: ['-c', script],
        env: { FIXTURE: dir, PATH: dir + '/bin:' + Deno.env.get('PATH') },
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      if (!result.success) {
        throw new Error(new TextDecoder().decode(result.stderr))
      }
      return new TextDecoder().decode(result.stdout)
    },
  }
  let options = (id: string) => ({
    transport,
    state: dir + '/receipts',
    root: dir + '/boxes/yak-' + id + '/workspace',
  })
  let actions = async () =>
    (await Deno.readTextFile(dir + '/acts')).trim().split('\n').map((s) =>
      JSON.parse(s) as string[]
    )
  let count = async (cmd: string, name: string) =>
    (await actions()).filter((a) => a[0] == cmd && a.includes(name)).length
  let exists = async (path: string) => {
    try {
      await Deno.stat(path)
      return true
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return false
      throw e
    }
  }

  let ref = { id: 'retry' }
  let provider = dockerSandboxes(g, options(ref.id))
  let first = await provider.request!(ref)
  await first.workspace.write('actual-exec', 'binary-safe text')
  let second = await dockerSandboxes(g, options(ref.id)).request!(ref)
  let read = await second.workspace.read('actual-exec')
  let changed = await outcome(() =>
    provider.request!({ ...ref, image: 'other' })
  )
  let changedRoot = await outcome(() =>
    dockerSandboxes(g, {
      ...options(ref.id),
      root: options(ref.id).root + '-changed',
    }).request!(ref)
  )
  let changedFrom = await outcome(() =>
    dockerSandboxes(g, { ...options(ref.id), prepare: () => Promise.resolve() })
      .request!({ ...ref, from: 'different-commit' })
  )
  let creates = await count('create', first.address!)
  await provider.dispose(ref)
  let removed = !await exists(dir + '/boxes/' + first.address)
  await provider.dispose(ref)
  let removals = await count('rm', first.address!)
  let released = await outcome(() => provider.request!(ref))
  test('Docker executes scripts and reconnects without relaunching; disposal removes once', () => {
    equal(read, 'binary-safe text')
    equal(first.address, second.address)
    equal(creates, 1)
    equal(removed, true)
    equal(removals, 1)
    equal(
      [changed, changedRoot, changedFrom],
      Array(3).fill('Sandbox request changed'),
    )
    equal(released, 'Sandbox was disposed')
  })

  let lostRef = { id: 'lost' }
  let lost = dockerSandboxes(g, options(lostRef.id))
  let lostConnection = await lost.request!(lostRef)
  await Deno.remove(dir + '/boxes/' + lostConnection.address, {
    recursive: true,
  })
  let missing = await outcome(() => lost.connect(lostRef))
  let recreate = await outcome(() => lost.request!(lostRef))
  await lost.dispose(lostRef)
  await lost.dispose(lostRef)
  let lostCreates = await count('create', lostConnection.address!)
  let lostRemovals = await count('rm', lostConnection.address!)
  test('Docker missing resources are never rebuilt or removed again', () => {
    equal(missing, 'Sandbox is missing; refusing reconstruction')
    equal(recreate, 'Interrupted or missing sandbox; refusing reconstruction')
    equal(lostCreates, 1)
    equal(lostRemovals, 0)
  })

  let listRef = { id: 'list-failure' }
  let listed = dockerSandboxes(g, options(listRef.id))
  await Deno.writeTextFile(dir + '/fail-ls', '')
  let listRequest = await outcome(() => listed.request!(listRef))
  await Deno.remove(dir + '/fail-ls')
  let beforeCreate = await count('create', 'yak-' + listRef.id)
  await listed.request!(listRef)
  await Deno.writeTextFile(dir + '/fail-ls', '')
  let listConnect = await outcome(() => listed.connect(listRef))
  let listDispose = await outcome(() => listed.dispose(listRef))
  let retained = await exists(dir + '/boxes/yak-' + listRef.id)
  await Deno.remove(dir + '/fail-ls')
  await listed.dispose(listRef)
  let listRemovals = await count('rm', 'yak-' + listRef.id)
  test('Docker list failures propagate, not absence or permission to create/delete', () => {
    equal(
      [listRequest, listConnect, listDispose],
      Array(3).fill('fixture-ls-failed'),
    )
    equal(beforeCreate, 0)
    equal(retained, true)
    equal(listRemovals, 1)
  })

  let foreignRef = { id: 'foreign' }
  let foreign = dockerSandboxes(g, options(foreignRef.id))
  let foreignWorkspace = (await foreign.request!(foreignRef)).workspace
  await foreignWorkspace.write('retained', 'original')
  let foreignEnv = dir + '/boxes/yak-foreign/env'
  let originalEnv = JSON.parse(await Deno.readTextFile(foreignEnv)) as Record<
    string,
    string
  >
  let tokens = Object.keys(originalEnv).filter((k) =>
    k.startsWith('YAK_SANDBOX_')
  )
  if (!tokens.length) {
    throw new Error('fixture did not receive an ownership env token')
  }
  let mutatedEnv = { ...originalEnv }
  for (let key of tokens) mutatedEnv[key] = 'somebody-else'
  await Deno.writeTextFile(foreignEnv, JSON.stringify(mutatedEnv))
  let foreignConnect = await outcome(() => foreign.connect(foreignRef))
  let foreignRequest = await outcome(() => foreign.request!(foreignRef))
  let foreignDispose = await outcome(() => foreign.dispose(foreignRef))
  let staleRead = await outcome(() => foreignWorkspace.read('retained'))
  let staleWrite = await outcome(() =>
    foreignWorkspace.write('retained', 'wrong')
  )
  let staleExport = await outcome(async () => {
    for await (let _ of foreign.export(foreignRef, ['retained'])) {
      /* consume */
    }
  })
  let retainedContent = await Deno.readTextFile(
    options('foreign').root + '/retained',
  )
  let foreignRemovals = await count('rm', 'yak-foreign')
  let foreignRetained = await exists(foreignEnv)
  let unownedRef = { id: 'unowned' }
  await Deno.mkdir(dir + '/boxes/yak-unowned')
  let unowned = dockerSandboxes(g, options(unownedRef.id))
  let unownedRequest = await outcome(() => unowned.request!(unownedRef))
  let unownedDispose = await outcome(() => unowned.dispose(unownedRef))
  test('Docker refuses foreign ownership and pre-existing unclaimed resources', () => {
    equal(
      [foreignConnect, foreignRequest, foreignDispose],
      Array(3).fill('Sandbox ownership changed'),
    )
    equal(
      [staleRead, staleWrite, staleExport],
      Array(3).fill('Sandbox ownership changed'),
    )
    equal(retainedContent, 'original')
    equal(foreignRemovals, 0)
    equal(foreignRetained, true)
    equal(unownedRequest, 'Sandbox name already exists without ownership')
    equal(unownedDispose, 'Sandbox is not owned by this provider')
  })

  // A second independent state directory with the same durable id creates a
  // different original token; swapping that environment cannot confer ownership.
  let replacement = dockerSandboxes(g, {
    ...options('foreign'),
    state: dir + '/replacement-state',
  })
  await Deno.remove(dir + '/boxes/yak-foreign', { recursive: true })
  await replacement.request!(foreignRef)
  let replacementEnv = JSON.parse(
    await Deno.readTextFile(foreignEnv),
  ) as Record<string, string>
  let distinctToken = tokens.some((k) => originalEnv[k] != replacementEnv[k])
  let replacementConnect = await outcome(() => foreign.connect(foreignRef))
  let replacementDispose = await outcome(() => foreign.dispose(foreignRef))
  let replacementSurvived = await exists(foreignEnv)
  await replacement.dispose(foreignRef)
  test('Docker same-id replacement requires the original random creation token', () => {
    equal(distinctToken, true)
    equal(
      [replacementConnect, replacementDispose],
      Array(2).fill('Sandbox ownership changed'),
    )
    equal(replacementSurvived, true)
  })

  let exportRef = { id: 'export' }
  let exporting = dockerSandboxes(g, options(exportRef.id))
  await exporting.request!(exportRef)
  let exportRoot = options(exportRef.id).root
  await Deno.mkdir(exportRoot + '/nested')
  await Deno.writeFile(
    exportRoot + '/nested/file',
    new Uint8Array([0, 255, 42]),
  )
  await Deno.writeTextFile(dir + '/outside-secret', 'no export')
  await Deno.symlink(dir + '/outside-secret', exportRoot + '/escape')
  await Deno.symlink(dir, exportRoot + '/escape-dir')
  let exported = []
  for await (let file of exporting.export(exportRef, ['nested/file'])) {
    exported.push(file)
  }
  let escapeErrors = []
  for (let path of ['escape', 'escape-dir/outside-secret']) {
    escapeErrors.push(
      await outcome(async () => {
        for await (let _ of exporting.export(exportRef, [path])) {
          /* consume */
        }
      }),
    )
  }
  let exportActsBefore = (await actions()).filter((a) =>
    a[0] == 'exec' && a.includes('bash')
  ).length
  let invalidPath = await outcome(async () => {
    for await (
      let _ of exporting.export(exportRef, ['../outside-secret'])
    ) { /* consume */ }
  })
  let exportActsAfter = (await actions()).filter((a) =>
    a[0] == 'exec' && a.includes('bash')
  ).length
  await exporting.dispose(exportRef)
  test('Docker exports binary bytes and refuses symlink and parent traversal', () => {
    equal(exported, [{
      path: 'nested/file',
      bytes: new Uint8Array([0, 255, 42]),
    }])
    equal(escapeErrors.every((e) => /OSError|NotADirectoryError/.test(e)), true)
    equal(invalidPath, 'Sandbox export paths must be relative without . or ..')
    equal(exportActsBefore, exportActsAfter)
  })

  let prepareRef = { id: 'prepare' }
  let attempts = 0
  let prepareOptions = {
    ...options(prepareRef.id),
    prepare: async (
      _from: string,
      workspace: import('@yaks/machine').Workspace,
    ) => {
      attempts++
      await workspace.write('source', 'prepared')
      if (attempts == 1) throw new Error('fixture-preparation-failed')
    },
  }
  let preparing = dockerSandboxes(g, prepareOptions)
  let failed = await outcome(() =>
    preparing.request!({ ...prepareRef, from: 'commit' })
  )
  let premature = await outcome(() => preparing.connect(prepareRef))
  await dockerSandboxes(g, prepareOptions).request!({
    ...prepareRef,
    from: 'commit',
  })
  let prepared = await preparing.connect(prepareRef)
  let source = await prepared.workspace.read('source')
  let prepareCreates = await count('create', 'yak-prepare')
  await preparing.dispose(prepareRef)
  test('Docker incomplete preparation blocks public connect and request resumes it', () => {
    equal(failed, 'fixture-preparation-failed')
    equal(premature, 'Sandbox preparation is incomplete')
    equal(attempts, 2)
    equal(source, 'prepared')
    equal(prepareCreates, 1)
  })

  let unreachable = dockerSandboxes(g, {
    ...options('offline'),
    transport: { execute: () => Promise.reject(new Error('fixture-offline')) },
  })
  let offline = await outcome(() => unreachable.connect({ id: 'offline' }))
  test('Docker never falls back to the local computer on transport failure', () =>
    equal(offline, 'fixture-offline'))
} finally {
  await Deno.remove(dir, { recursive: true })
}

test('sandbox exports refuse absolute and traversing paths before reading files', async () => {
  for (let path of ['/etc/passwd', '../key', 'dir/../key', 'dir/./key', '']) {
    await throws(
      () => exportPath(path),
      'Sandbox export paths must be relative',
    )
  }
  equal(exportPath('dist/out.bin'), 'dist/out.bin')
})
