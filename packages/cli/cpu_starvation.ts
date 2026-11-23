import * as disk from '@yaks/file/io'
import * as system from '@yaks/process/system'

let WINDOW = 30_000
let SAMPLE = 1000

let pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

let usage = (path: string) =>
  disk.readTextFile(`${path}/cpu.stat`).then(
    (text) => Number(/^usage_usec (\d+)$/m.exec(text)?.[1]),
    () => NaN,
  )

let children = async (path: string): Promise<string[]> => {
  let out: string[] = []
  try {
    for await (let entry of disk.readDir(path)) {
      if (entry.isDirectory) out.push(`${path}/${entry.name}`)
    }
  } catch { /* A transient scope can end between samples. */ }
  return out
}

// Sample only after a measured scheduler delay. Systemd's cgroup counters
// include every descendant of a unit, including its short-lived subprocesses.
let consumers = async () => {
  let group = /^0::(.*)$/m.exec(await disk.readTextFile('/proc/self/cgroup'))
    ?.[1].match(/^.*?\/user@\d+\.service(?:\/|$)/)?.[0].replace(/\/$/, '')
  if (!group) return 'CPU attribution unavailable for this cgroup'
  let root = `/sys/fs/cgroup${group}`
  let scopes = (await children(root)).filter((path) =>
    !path.endsWith('/init.scope')
  )
  let units = (await Promise.all(
    scopes.map((path) => path.endsWith('.slice') ? children(path) : [path]),
  )).flat()
  let before = await Promise.all(units.map(usage))
  let at = performance.now()
  await pause(SAMPLE)
  let after = await Promise.all(units.map(usage))
  return cpuConsumers(units, before, after, performance.now() - at)
}

export let cpuConsumers = (
  units: string[],
  before: number[],
  after: number[],
  ms: number,
): string => {
  let top = units.map((unit, i) => ({
    unit: unit.slice(unit.lastIndexOf('/') + 1),
    cpu: (after[i] - before[i]) / 1e6,
  })).filter(({ cpu }) => cpu > 0).sort((a, b) => b.cpu - a.cpu).slice(0, 4)
  return top.length
    ? `Top local cgroups over the next ${(ms / 1000).toFixed(1)} s: ` +
      top.map(({ unit, cpu }) => `${unit} (${cpu.toFixed(2)} CPU s)`).join(', ')
    : 'No local cgroup CPU use could be attributed after the delay'
}

// All serving processes (including two during handover) share this stamp.
// Keep the inode so a new observer always locks the same file.
let claim = async (at: number) => {
  let runtime = system.env.get('XDG_RUNTIME_DIR')
  if (!runtime) return undefined
  let path = `${runtime}/yak-cpu-starvation`
  let file = await disk.open(path, { create: true, write: true, mode: 0o600 })
  try {
    await file.lock(true)
    let last = Number(await disk.readTextFile(path))
    if (at <= last) return false
    await disk.writeTextFile(path, String(at))
    return at - last >= WINDOW
  } finally {
    file.close()
  }
}

export let cpuWatch = (
  {
    now = Date.now,
    reserve = claim,
    sample = consumers,
  } = {},
) => {
  let seen = -Infinity, checked = -Infinity
  return async (evidence: string, report: (error: Error) => void) => {
    let at = now()
    let quiet = at - seen >= WINDOW
    seen = at
    if (at - checked < SAMPLE) return
    checked = at
    let dedup = await reserve(at).catch(() => undefined)
    if (!(dedup ?? quiet)) return
    let activity = await sample().catch(() => 'CPU attribution unavailable')
    report(Object.assign(
      new Error('The box kept a read worker waiting for a CPU', {
        cause: new Error(`${evidence}\n${activity}`),
      }),
      { name: 'CPUStarvation', fault: 'box:cpu-starvation' },
    ))
  }
}

export let cpuStarvation = cpuWatch()
