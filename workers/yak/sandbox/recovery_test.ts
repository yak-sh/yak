import { equal, test, throws } from '@yaks/testing'
import { recovery } from './recovery.ts'

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
    run: (mode: string, ...args: string[]) => {
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
      if (mode == 'read') {
        return Promise.resolve(
          archive.subarray(Number(args[0]), Number(args[0]) + Number(args[1]))
            .toBase64(),
        )
      }
      if (mode == 'write') archive = Uint8Array.fromBase64(args[1])
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
