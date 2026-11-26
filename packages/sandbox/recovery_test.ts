import { equal, test, throws } from '@yaks/testing'
import {
  chunks,
  filesystem,
  recovery,
  RECOVERY_HOST,
  snapshot,
} from './recovery.ts'

type Stage = 'createMultipartUpload' | 'uploadPart' | 'complete' | 'put'

let fixture = () => {
  let state = new Map<string, unknown>()
  let objects = new Map<string, Uint8Array>()
  let files = new Map<string, string>()
  let awake = false
  let baseline = false
  let ready = false
  let archive = new Uint8Array()
  let restoreFailure = false
  let writeFailure = false
  let failures = new Map<Stage, number>()
  let waits: number[] = []
  let reads = 0
  let aborted = 0
  let fault = (stage: Stage) => {
    let left = failures.get(stage) ?? 0
    if (!left) return
    failures.set(stage, left - 1)
    return new Error(
      `${stage}: We encountered an internal error. Please try again. (10001)`,
    )
  }
  let box = {
    live: () => Promise.resolve(awake),
    read: async function* () {
      reads++
      yield archive
    },
    restore: (name: string, size: number) => {
      if (restoreFailure) return Promise.reject(new Error('restore failed'))
      let content = objects.get(`workbench/person-space/${name}`)!
      equal(content.length, size)
      files = new Map(JSON.parse(new TextDecoder().decode(content)))
      return Promise.resolve('')
    },
    run: (mode: string) => {
      awake = true
      if (mode == 'fresh' || mode == 'existing') {
        baseline = true
        return Promise.resolve(ready ? 'existing' : 'fresh')
      }
      if (mode == 'ready') ready = true
      if (mode == 'save') {
        archive = new TextEncoder().encode(JSON.stringify([...files]))
        return Promise.resolve(String(archive.length))
      }
      return Promise.resolve('')
    },
  }
  let held = recovery(
    box,
    {
      get: <T>(key: string) => Promise.resolve(state.get(key) as T | undefined),
      put: (key, value) => {
        if (writeFailure) return Promise.reject(new Error('head write failed'))
        state.set(key, value)
        return Promise.resolve()
      },
      delete: (key) => {
        state.delete(key)
        return Promise.resolve()
      },
    },
    {
      createMultipartUpload: (key) => {
        let error = fault('createMultipartUpload')
        if (error) return Promise.reject(error)
        let parts: Uint8Array[] = []
        return Promise.resolve({
          uploadPart: (partNumber, bytes) => {
            let error = fault('uploadPart')
            if (error) return Promise.reject(error)
            parts.push(bytes)
            return Promise.resolve({ partNumber, etag: String(partNumber) })
          },
          complete: () => {
            let error = fault('complete')
            if (error) return Promise.reject(error)
            objects.set(key, parts[0])
            return Promise.resolve()
          },
          abort: () => {
            aborted++
            return Promise.resolve()
          },
        })
      },
      put: (key, content) => {
        let error = fault('put')
        if (error) return Promise.reject(error)
        objects.set(key, new TextEncoder().encode(content))
        return Promise.resolve()
      },
      list: ({ prefix }) =>
        Promise.resolve({
          objects: [...objects.keys()].filter((key) => key.startsWith(prefix))
            .map((key) => ({ key })),
          truncated: false,
        }),
      delete: (keys) => {
        for (let key of keys) objects.delete(key)
        return Promise.resolve()
      },
    },
    'person-space',
    (ms) => Promise.resolve(void waits.push(ms)),
  )
  return {
    ...held,
    shutdown: held.stop,
    objects,
    state,
    waits,
    get reads() {
      return reads
    },
    get aborted() {
      return aborted
    },
    get awake() {
      return awake
    },
    get baseline() {
      return baseline
    },
    get files() {
      return files
    },
    failRestore: (fail: boolean) => {
      restoreFailure = fail
    },
    failWrite: (fail: boolean) => {
      writeFailure = fail
    },
    fail: (stage: Stage, times: number) => {
      failures.set(stage, times)
    },
    stop: () => {
      awake = false
      baseline = false
      ready = false
      files = new Map()
      held.reset()
      return Promise.resolve()
    },
  }
}

test('workbench files return after idle shutdown, with older snapshots retained', async () => {
  let bench = fixture()
  await bench.prepare()
  equal(bench.baseline, true)
  bench.files.set('/etc/notes', 'original')
  await bench.save()
  bench.stop()
  await bench.prepare()
  equal(bench.files.get('/etc/notes'), 'original')
  bench.files.set('/etc/notes', 'edited')
  await bench.save()
  equal(bench.objects.size, 4)
  bench.stop()
  await bench.prepare()
  equal(bench.files.get('/etc/notes'), 'edited')
})

test('a failed recovery retries before allowing workspace access', async () => {
  let bench = fixture()
  await bench.prepare()
  bench.files.set('/workspace/report', 'unique')
  await bench.save()
  bench.stop()
  bench.failRestore(true)
  await throws(bench.prepare, 'restore failed')
  bench.failRestore(false)
  await bench.prepare()
  equal(bench.files.get('/workspace/report'), 'unique')
})

test('failed head persistence leaves unique bytes live and a durable recovery receipt', async () => {
  let bench = fixture()
  await bench.prepare()
  bench.files.set('/workspace/report', 'unique')
  bench.failWrite(true)
  await throws(bench.save, 'head write failed')
  equal(bench.awake, true)
  equal(bench.files.get('/workspace/report'), 'unique')
  equal(bench.objects.size, 2)
})

for (
  let [stage, failures, reads, aborted] of [
    ['createMultipartUpload', 2, 1, 0],
    ['uploadPart', 2, 1, 0],
    ['uploadPart', 3, 2, 1],
    ['complete', 1, 2, 1],
    ['put', 1, 1, 0],
  ] as const
) {
  test(`a snapshot recovers from ${failures} transient ${stage} failures`, async () => {
    let bench = fixture()
    await bench.prepare()
    bench.files.set('/workspace/report', 'unique')
    bench.fail(stage, failures)
    await bench.shutdown(bench.stop)
    equal(bench.waits.length, failures)
    equal(bench.waits.every((ms) => ms > 0), true)
    equal(bench.reads, reads)
    equal(bench.aborted, aborted)
    equal(bench.objects.size, 2)
    await bench.prepare()
    equal(bench.files.get('/workspace/report'), 'unique')
  })
}

test('an exhausted snapshot leaves the previous head and the running workbench intact', async () => {
  let bench = fixture()
  await bench.prepare()
  bench.files.set('/workspace/report', 'previous')
  await bench.save()
  let head = [...bench.state]
  let objects = [...bench.objects]
  bench.files.set('/workspace/report', 'latest')
  bench.fail('complete', 3)
  await throws(() => bench.shutdown(bench.stop), 'internal error')
  equal(bench.awake, true)
  equal(bench.files.get('/workspace/report'), 'latest')
  equal([...bench.state], head)
  equal([...bench.objects], objects)
  await bench.shutdown(bench.stop)
  await bench.prepare()
  equal(bench.files.get('/workspace/report'), 'latest')
})

test('disposal of a stopped workbench does not recreate its filesystem', async () => {
  let bench = fixture()
  await bench.save()
  equal(bench.awake, false)
  equal(bench.objects.size, 0)
})

test('a workspace call arriving during shutdown restores before reading', async () => {
  let bench = fixture()
  await bench.prepare()
  bench.files.set('/workspace/report', 'unique')
  let started = Promise.withResolvers<void>()
  let resume = Promise.withResolvers<void>()
  let stopping = bench.shutdown(async () => {
    started.resolve()
    await resume.promise
    bench.stop()
  })
  await started.promise
  let reading = bench.use(() =>
    Promise.resolve(bench.files.get('/workspace/report'))
  )
  resume.resolve()
  await stopping
  equal(await reading, 'unique')
})

test('idle shutdown skips running processes and restores files after they finish', async () => {
  let bench = fixture()
  let busy = true
  let idle = () => bench.idle(() => Promise.resolve(busy), bench.stop)
  await bench.use(() =>
    Promise.resolve(bench.files.set('/workspace/note', 'kept'))
  )
  await idle()
  equal(bench.awake, true)
  busy = false
  await idle()
  equal(bench.awake, false)
  equal(
    await bench.use(() => Promise.resolve(bench.files.get('/workspace/note'))),
    'kept',
  )
})

test('an alarm that waited for workspace activity leaves a fresh idle window', async () => {
  let bench = fixture()
  let started = Promise.withResolvers<void>()
  let finished = Promise.withResolvers<void>()
  let writing = bench.use(async () => {
    started.resolve()
    await finished.promise
    bench.files.set('/workspace/note', 'kept')
  })
  await started.promise
  let idle = () => bench.idle(() => Promise.resolve(false), bench.stop)
  let expiring = idle()
  finished.resolve()
  await writing
  await expiring
  equal(bench.awake, true)
  await idle()
  equal(bench.awake, false)
})

test('confirmed purge removes snapshots and receipt after stopping the workbench', async () => {
  let bench = fixture()
  await bench.prepare()
  bench.files.set('/workspace/report', 'unique')
  await bench.save()
  bench.objects.set('workbench/another-person/keep', new Uint8Array([1]))
  await bench.purge(() => {
    bench.stop()
    return Promise.resolve()
  })
  equal([...bench.objects.keys()], ['workbench/another-person/keep'])
  equal(bench.state.size, 0)
  await bench.prepare()
  equal(bench.files.size, 0)
})

test('archive byte chunks are rebatched intact across file and multipart boundaries', async () => {
  let source = async function* () {
    yield new Uint8Array([0, 1])
    yield new Uint8Array([2, 3, 4, 5, 6, 7, 8])
    yield new Uint8Array([9])
  }
  let result = []
  for await (let part of chunks(source(), 4)) result.push([...part])
  equal(result, [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]])
})

test('an outbound archive read streams bytes only from the calling container', async () => {
  let key = 'a9560c84-ae13-421c-96dc-34bd72357834.tar.gz'
  let reads: string[] = []
  let bytes = Uint8Array.of(0, 128, 255)
  let bucket = {
    get: (path: string) => {
      reads.push(path)
      return Promise.resolve({
        body: new Blob([bytes]).stream(),
        size: bytes.length,
      })
    },
  }
  let get = (path: string, method = 'GET') =>
    snapshot(
      bucket,
      'mine',
      new Request(`http://${RECOVERY_HOST}/${path}`, { method }),
    )
  equal((await get(`others/${key}`)).status, 404)
  equal((await get(key, 'PUT')).status, 405)
  let reply = await get(key)
  equal(reply.headers.get('Content-Length'), '3')
  equal([...await reply.bytes()], [0, 128, 255])
  equal(reads, [`workbench/mine/${key}`])
})

// The recovery script, run over a directory standing in for the container's /.
let sh = async (command: string) => {
  let out = await new Deno.Command('sh', { args: ['-c', command] }).output()
  let text = new TextDecoder()
  return {
    exitCode: out.code,
    stdout: text.decode(out.stdout),
    stderr: text.decode(out.stderr),
  }
}
let local = (root: string) =>
  filesystem(
    { live: () => true, exec: sh },
    async function* () {},
    root,
  )
let image = async (root: string, files: Record<string, string>) => {
  for (let [name, text] of Object.entries(files)) {
    let dir = `${root}/${name}`.replace(/\/[^/]*$/, '')
    await Deno.mkdir(dir, { recursive: true })
    await Deno.writeTextFile(`${root}/${name}`, text)
  }
}
let listed = async (root: string, dir = ''): Promise<string[]> => {
  let names: string[] = []
  for await (let e of Deno.readDir(`${root}/${dir}`)) {
    let name = dir ? `${dir}/${e.name}` : e.name
    if (name == '.yak-recovery') continue
    names.push(...e.isDirectory ? await listed(root, name) : [name])
  }
  return names.sort()
}

test('a woken sandbox gets back its changed files and deletions, without caches', async () => {
  let made = await Deno.makeTempDir()
  try {
    let base = {
      'etc/conf': 'image',
      'etc/gone': 'image',
      'tmp/seed': 'image',
      'var/cache/apt/seed': 'image',
    }
    let [was, woken] = [`${made}/was`, `${made}/woken`]
    for (let root of [was, woken]) {
      await image(root, base)
      equal(await local(root).run('fresh'), 'fresh')
    }
    await image(was, {
      'etc/conf': 'edited',
      'workspace/notes': 'kept',
      'tmp/scratch': 'temporary',
      'var/cache/apt/pkg.deb': 'cached',
      'root/.npm/_cacache/blob': 'cached',
    })
    await Deno.remove(`${was}/etc/gone`)
    let size = await local(was).run('save')
    let archive = `file://${was}/.yak-recovery/snapshot.tar.gz`
    let fs = local(woken)
    let said = await fs.run('restore', archive, size)
    equal(typeof JSON.parse(said).restoreMs, 'number')
    equal(await listed(woken), [
      'etc/conf',
      'tmp/seed',
      'var/cache/apt/seed',
      'workspace/notes',
    ])
    equal(await Deno.readTextFile(`${woken}/etc/conf`), 'edited')
    await throws(() => fs.run('restore', archive, String(Number(size) + 1)))

    await Deno.remove(`${woken}/.yak-recovery/baseline.json`)
    await Deno.writeTextFile(
      `${woken}/workspace/notes`,
      'after missing baseline',
    )
    let repaired = await fs.run('save')
    equal(await Deno.readTextFile(`${woken}/.yak-recovery/baseline.json`), '{}')
    await local(was).run(
      'restore',
      `file://${woken}/.yak-recovery/snapshot.tar.gz`,
      repaired,
    )
    equal(
      await Deno.readTextFile(`${was}/workspace/notes`),
      'after missing baseline',
    )
  } finally {
    await Deno.remove(made, { recursive: true })
  }
})

test('a snapshot skips entries it cannot read instead of failing', async () => {
  let root = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(`${root}/notes`, 'kept')
    await Deno.mkdir(`${root}/sealed`, { mode: 0o000 })
    let fs = local(root)
    equal(await fs.run('fresh'), 'fresh')
    await Deno.writeTextFile(`${root}/notes`, 'edited')
    equal(Number(await fs.run('save')) > 0, true)
  } finally {
    await Deno.chmod(`${root}/sealed`, 0o700)
    await Deno.remove(root, { recursive: true })
  }
})

test('a snapshot keeps every byte when an interrupted write left the baseline empty', async () => {
  let root = await Deno.makeTempDir()
  try {
    await Deno.mkdir(`${root}/.yak-recovery`)
    await Deno.writeTextFile(`${root}/.yak-recovery/baseline.json`, '')
    await Deno.writeTextFile(`${root}/notes`, 'kept')
    let fs = local(root)
    equal(Number(await fs.run('save')) > 0, true)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
