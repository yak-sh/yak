// Real POSIX control receipts are exercised against a small sbx command double;
// lost resources, retries and disposal are checked without creating containers.
import { equal, test, throws } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
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
let escaped = false
try {
  await Deno.mkdir(dir + '/bin')
  await Deno.mkdir(dir + '/boxes')
  await Deno.writeTextFile(
    dir + '/bin/sbx',
    `#!/bin/bash
set -eu
case "$1" in
ls) ls "$FIXTURE/boxes";;
create) mkdir "$FIXTURE/boxes/$3"; echo create >> "$FIXTURE/acts";;
exec) echo exec >> "$FIXTURE/acts"; if test "\${3:-}" = id; then printf 1000; elif test "\${3:-}" = printenv; then printf %s "\${2#yak-}"; fi;;
rm) rmdir "$FIXTURE/boxes/$3"; echo rm >> "$FIXTURE/acts";;
*) exit 9;;
esac
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
  let provider = dockerSandboxes(g, { transport, state: dir + '/receipts' })
  let ref = { id: mint() }
  let first = await provider.request!(ref)
  let second = await dockerSandboxes(g, { transport, state: dir + '/receipts' })
    .request!(ref)
  let changed = await throws(() =>
    provider.request!({ ...ref, image: 'different' })
  )
  await Deno.remove(dir + '/boxes/' + first.address)
  let missing = await throws(() => provider.connect(ref))
  let recreate = await throws(() => provider.request!(ref))
  await provider.dispose(ref)
  await provider.dispose(ref)
  let released = await throws(() => provider.request!(ref))
  let collision = { id: mint() }
  await Deno.mkdir(dir + '/boxes/yak-' + collision.id)
  let unowned = await throws(() => provider.request!(collision))
  let unownedDispose = await throws(() => provider.dispose(collision))
  let acts = (await Deno.readTextFile(dir + '/acts')).trim().split('\n')
  test('Docker sandbox request reconnects to one resource without relaunching', () => {
    equal(first.address, second.address)
    equal(acts.filter((s) => s == 'create').length, 1)
  })
  test('Docker sandbox refuses changed requests, missing resources and foreign names', () => {
    equal(
      [changed, missing, recreate, released, unowned, unownedDispose].every(
        Boolean,
      ),
      true,
    )
  })
  test('Docker disposal is idempotent even after the external resource vanished', () => {
    equal(acts.filter((s) => s == 'rm').length, 0)
  })
  // Errors from the selected computer propagate, never selecting a local sbx.
  let unreachable = dockerSandboxes(g, {
    state: dir,
    transport: {
      execute: () => {
        escaped = true
        return Promise.reject(new Error('offline'))
      },
    },
  })
  let failure = await throws(() => unreachable.connect(ref))
  test('Docker sandbox fails closed on an unreachable computer', () => {
    equal(escaped && Boolean(failure), true)
  })
} finally {
  await Deno.remove(dir, { recursive: true })
}

test('sandbox exports refuse absolute and traversing paths before reading files', async () => {
  for (let path of ['/etc/passwd', '../key', 'dir/../key', 'dir/./key', '']) {
    await throws(() => exportPath(path))
  }
  equal(exportPath('dist/out.bin'), 'dist/out.bin')
})
