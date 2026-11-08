// A separate isolate can see the main thread's kernel wait while that thread
// cannot run a timer. Shared memory keeps its evidence available immediately
// when the held tick resumes, before any queued worker message is delivered.
import * as disk from '@yaks/file/io'
import * as system from '@yaks/process/system'

let SLOTS = 1024, BYTES = 288, HEAD = 8, TEXT = 256
let epoch = () => performance.timeOrigin + performance.now()

export type WaitSample = {
  at: number
  state: string
  cpu?: number
  wait?: number
}
export type WaitLog = {
  buffer: SharedArrayBuffer
  add: (sample: WaitSample) => void
  read: () => WaitSample[]
}

/** Four minutes of 4 Hz samples, bounded even if the main thread never runs.
 * Each slot publishes its sequence after its bytes; a reader discards a slot
 * overwritten during its copy. There is one writer, in the sampling worker. */
export let waitLog = (
  buffer = new SharedArrayBuffer(HEAD + SLOTS * BYTES),
): WaitLog => {
  let words = new Int32Array(buffer), data = new DataView(buffer)
  let encode = new TextEncoder(), decode = new TextDecoder()
  return {
    buffer,
    add: ({ at, state, cpu, wait }) => {
      let seq = Atomics.load(words, 0) + 1
      let pos = HEAD + (seq % SLOTS) * BYTES
      Atomics.store(words, pos / 4, -seq)
      let text = encode.encode(state).slice(0, TEXT)
      data.setInt32(pos + 4, text.length)
      data.setFloat64(pos + 8, at)
      data.setFloat64(pos + 16, cpu ?? NaN)
      data.setFloat64(pos + 24, wait ?? NaN)
      new Uint8Array(buffer, pos + 32, text.length).set(text)
      Atomics.store(words, pos / 4, seq)
      Atomics.store(words, 0, seq)
    },
    read: () => {
      let end = Atomics.load(words, 0), samples: WaitSample[] = []
      for (let seq = Math.max(1, end - SLOTS + 1); seq <= end; seq++) {
        let pos = HEAD + (seq % SLOTS) * BYTES
        if (Atomics.load(words, pos / 4) != seq) continue
        let size = data.getInt32(pos + 4)
        if (size < 0 || size > TEXT) continue
        let at = data.getFloat64(pos + 8)
        let cpu = data.getFloat64(pos + 16), wait = data.getFloat64(pos + 24)
        let text = new Uint8Array(buffer, pos + 32, size).slice()
        if (Atomics.load(words, pos / 4) != seq) continue
        samples.push({
          at,
          state: decode.decode(text),
          ...(Number.isFinite(cpu) ? { cpu } : {}),
          ...(Number.isFinite(wait) ? { wait } : {}),
        })
      }
      return samples
    },
  }
}

/** One kernel observation. stat's command may contain spaces or parentheses;
 * its final closing parenthesis ends it. Linux reports scheduler times in ns. */
export let kernelWait = async (
  place: string,
  read: (path: string) => Promise<string> = disk.readTextFile,
): Promise<Omit<WaitSample, 'at'>> => {
  try {
    let [stat, wchan, sched] = await Promise.all(
      ['stat', 'wchan', 'schedstat'].map((name) =>
        read(`/proc/${place}/${name}`)
      ),
    )
    let state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
    let [cpu, wait] = sched.trim().split(/\s+/).map(Number)
    if (!state || !Number.isFinite(cpu) || !Number.isFinite(wait)) {
      throw new Error('malformed /proc thread sample')
    }
    return {
      state: `${state}/${wchan.trim() || 'unknown'}`,
      cpu: cpu / 1e6,
      wait: wait / 1e6,
    }
  } catch (error) {
    return { state: `sampling failed: ${String(error).slice(0, 180)}` }
  }
}

let ticking = (fn: () => void, ms: number) => {
  let timer = system.setInterval(fn, ms)
  system.unrefTimer(timer)
  return () => system.clearInterval(timer)
}

/** The worker's timer boundary. Slow reads never queue another sampling pass. */
export let watchWait = (
  place: string,
  log: WaitLog,
  {
    read = disk.readTextFile,
    now = epoch,
    tick = ticking,
  }: {
    read?: (path: string) => Promise<string>
    now?: () => number
    tick?: (fn: () => void, ms: number) => () => void
  } = {},
): () => void => {
  let active = false, closed = false
  let sample = async () => {
    if (active || closed) return
    active = true
    try {
      let value = await kernelWait(place, read)
      if (!closed) log.add({ at: now(), ...value })
    } finally {
      active = false
    }
  }
  void sample()
  let stop = tick(() => void sample(), 250)
  return () => {
    closed = true
    stop()
  }
}

let seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Coverage and the six most frequent waits, including where in the gap they
 * occurred. A sampling worker starved too leaves a visible coverage gap. */
export let waits = (
  samples: WaitSample[],
  start: number,
  end: number,
): string => {
  let kept = samples.filter((s) => s.at >= start && s.at <= end)
  if (!kept.length) {
    return 'kernel wait sampling: no observations during the gap'
  }
  let groups = new Map<string, { count: number; first: number; last: number }>()
  let last = start, gap = 0
  for (let sample of kept) {
    gap = Math.max(gap, sample.at - last)
    last = sample.at
    let group = groups.get(sample.state)
    if (group) {
      group.count++
      group.last = sample.at
    } else {
      groups.set(sample.state, { count: 1, first: sample.at, last: sample.at })
    }
  }
  gap = Math.max(gap, end - last)
  let lines = [
    `kernel wait sampling: ${kept.length} observations, largest unsampled interval ${
      seconds(gap)
    }`,
  ]
  let first = kept[0], final = kept.at(-1)!
  if (
    first.cpu != undefined && final.cpu != undefined &&
    first.wait != undefined && final.wait != undefined
  ) {
    lines.push(
      `sampled scheduler: CPU ${
        seconds(final.cpu - first.cpu)
      }, runnable wait ${seconds(final.wait - first.wait)}`,
    )
  }
  for (
    let [state, group] of [...groups].sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
  ) {
    lines.push(
      `${group.count} observations ${seconds(group.first - start)}–${
        seconds(group.last - start)
      }: ${state}`,
    )
  }
  if (groups.size > 6) {
    lines.push(`${groups.size - 6} other wait states omitted`)
  }
  return lines.join('\n')
}

type WaitWorker = {
  postMessage: (data: { place: string; buffer: SharedArrayBuffer }) => void
  terminate: () => void
  onerror: ((error: ErrorEvent) => void) | null
}
export type WaitSampler = {
  take: (ms: number) => string | undefined
  close: () => void
}

/** Start one independent observer for this process's main thread. */
export let waitSampler = (
  place: string | undefined,
  {
    worker = () =>
      new Worker(new URL('./stall_wait_worker.ts', import.meta.url).href, {
        type: 'module',
      }),
    now = epoch,
  }: {
    worker?: () => WaitWorker
    now?: () => number
  } = {},
): WaitSampler => {
  if (!place) {
    return {
      take: () => 'kernel wait sampling unavailable: no /proc thread path',
      close: () => {},
    }
  }
  let log = waitLog(),
    running: WaitWorker | undefined,
    failed: string | undefined
  try {
    running = worker()
    running.onerror = (error) => {
      error.preventDefault()
      failed = error.message
    }
    running.postMessage({ place, buffer: log.buffer })
  } catch (error) {
    failed = String(error)
    running?.terminate()
    running = undefined
  }
  return {
    take: (ms) => {
      let end = now()
      return waits(log.read(), end - ms, end) +
        (failed ? `\nwait worker failed: ${failed}` : '')
    },
    close: () => {
      running?.terminate()
      running = undefined
    },
  }
}
