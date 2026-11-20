import { equal, test, throws } from '@yaks/testing'
import { chunks, filesystem, recovery } from './recovery.ts'

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
  let box = {
    live: () => Promise.resolve(awake),
    read: async function* () {
      yield archive
    },
    write: (offset: number, content: Uint8Array) => {
      let next = new Uint8Array(offset + content.length)
      next.set(archive.subarray(0, offset))
      next.set(content, offset)
      archive = next
      return Promise.resolve()
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
      if (mode == 'restore') {
        if (restoreFailure) return Promise.reject(new Error('restore failed'))
        files = new Map(JSON.parse(new TextDecoder().decode(archive)))
      }
      return Promise.resolve('')
    },
  }
  let held = recovery(box, {
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
  }, {
    createMultipartUpload: (key) => {
      let parts: Uint8Array[] = []
      return Promise.resolve({
        uploadPart: (partNumber, bytes) => {
          parts.push(bytes)
          return Promise.resolve({ partNumber, etag: String(partNumber) })
        },
        complete: () => {
          objects.set(key, parts[0])
          return Promise.resolve()
        },
      })
    },
    get: (key) =>
      Promise.resolve(
        objects.has(key)
          ? {
            arrayBuffer: () =>
              Promise.resolve(objects.get(key)!.slice().buffer),
          }
          : null,
      ),
    put: (key, content) => {
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
  }, 'person-space')
  return {
    ...held,
    shutdown: held.stop,
    objects,
    state,
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
    stop: () => {
      awake = false
      baseline = false
      ready = false
      files = new Map()
      held.reset()
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

let large = new Uint8Array(196_608).fill(255)
test('restoring large archive bytes uses the file API and a bounded command', async () => {
  let calls: string[] = []
  let written: Uint8Array | undefined
  let box = filesystem({
    getState: () => Promise.resolve({ status: 'healthy' }),
    exec: (command) => {
      calls.push(command)
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    },
    writeFile: (_path, content) => {
      written = Uint8Array.fromBase64(content)
      return Promise.resolve()
    },
  }, async function* () {})
  await box.write(0, large)
  equal(written?.length, large.length)
  equal(written?.[large.length - 1], 255)
  equal(calls.length, 1)
  equal(calls[0].length < 8_192, true)
})

test('a snapshot skips entries it cannot read instead of failing', async () => {
  let root = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(`${root}/notes`, 'kept')
    await Deno.mkdir(`${root}/sealed`, { mode: 0o000 })
    let fs = filesystem(
      {
        getState: () => Promise.resolve({ status: 'running' }),
        exec: async (command) => {
          let out = await new Deno.Command('sh', { args: ['-c', command] })
            .output()
          let text = new TextDecoder()
          return {
            exitCode: out.code,
            stdout: text.decode(out.stdout),
            stderr: text.decode(out.stderr),
          }
        },
        writeFile: () => undefined,
      },
      async function* () {},
      root,
    )
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
    let fs = filesystem(
      {
        getState: () => Promise.resolve({ status: 'running' }),
        exec: async (command) => {
          let out = await new Deno.Command('sh', { args: ['-c', command] })
            .output()
          let text = new TextDecoder()
          return {
            exitCode: out.code,
            stdout: text.decode(out.stdout),
            stderr: text.decode(out.stderr),
          }
        },
        writeFile: () => undefined,
      },
      async function* () {},
      root,
    )
    equal(Number(await fs.run('save')) > 0, true)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
