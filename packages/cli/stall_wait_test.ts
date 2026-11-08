import { equal, ok, test } from '@yaks/testing'
import { kernelWait, waitLog, waits, waitSampler } from './stall_wait.ts'

let sample = (at: number, state = 'D/io_schedule') => ({
  at,
  state,
  cpu: at / 10,
  wait: at / 20,
})

test('kernel observations name the wait and scheduler counters of the given thread', async () => {
  let files: Record<string, string> = {
    '/proc/12/task/13/stat': '13 (a command (with spaces)) D 12 0 0',
    '/proc/12/task/13/wchan': 'io_schedule\n',
    '/proc/12/task/13/schedstat': '150000000 25000000 3\n',
  }
  equal(
    await kernelWait('12/task/13', (path) => Promise.resolve(ok(files[path]))),
    {
      state: 'D/io_schedule',
      cpu: 150,
      wait: 25,
    },
  )
  equal(
    await kernelWait('gone', () => Promise.reject(new Error('missing thread'))),
    {
      state: 'sampling failed: Error: missing thread',
    },
  )
})

test('the shared wait history retains the newest observations within its bound', () => {
  let writer = waitLog(), reader = waitLog(writer.buffer)
  for (let at = 0; at < 1100; at++) writer.add(sample(at))
  let kept = reader.read()
  equal(kept.length, 1024)
  equal(kept[0], sample(76))
  equal(kept.at(-1), sample(1099))
})

test('wait evidence excludes other intervals and exposes missing observer coverage', () => {
  let said = waits(
    [
      sample(0, 'old'),
      sample(1000),
      sample(1250),
      sample(4000, 'R/0'),
      sample(5000, 'later'),
    ],
    1000,
    4500,
  )
  ok(!said.includes('old'))
  ok(!said.includes('later'))
  ok(said.includes('3 observations, largest unsampled interval 2.8 s'))
  ok(said.includes('2 observations 0.0 s–0.3 s: D/io_schedule'))
  ok(said.includes('CPU 0.3 s, runnable wait 0.1 s'))
  equal(
    waits([], 0, 1000),
    'kernel wait sampling: no observations during the gap',
  )
})

test('a held main thread reads the independent observer without waiting for its messages', () => {
  let owned: ReturnType<typeof waitLog> | undefined, stopped = 0
  let worker = {
    onerror: null as ((error: ErrorEvent) => void) | null,
    postMessage: (
      { place, buffer }: { place: string; buffer: SharedArrayBuffer },
    ) => {
      equal(place, '12/task/13')
      owned = waitLog(buffer)
    },
    terminate: () => {
      stopped++
    },
  }
  let observer = waitSampler('12/task/13', {
    worker: () => worker,
    now: () => 2000,
  })
  ok(owned).add(sample(1250))
  ok(observer.take(1000)?.includes('D/io_schedule'))
  let failure = new ErrorEvent('error', {
    message: 'observer failed',
    cancelable: true,
  })
  ok(worker.onerror)(failure)
  ok(failure.defaultPrevented)
  ok(observer.take(1000)?.includes('wait worker failed: observer failed'))
  observer.close()
  observer.close()
  equal(stopped, 1)
})

test('unavailable and failed observers leave an explanation in the stall', () => {
  ok(waitSampler(undefined).take(1000)?.includes('no /proc thread path'))
  let observer = waitSampler('12/task/13', {
    worker: () => {
      throw new Error('cannot start')
    },
  })
  ok(observer.take(1000)?.includes('wait worker failed: Error: cannot start'))
  observer.close()
})
