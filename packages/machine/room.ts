// A machine's room: the memory it has free and how hard it is pressed for
// memory, read the same way on every computer (one control script over its
// transport) and judged by pure functions. Whatever starts work on a machine
// asks its {@link admitter} first, and work that does not fit waits for room
// rather than taking the machine down.

import type { ComputerTransport } from './workspace.ts'
import { localConnector } from './connectors.ts'

/** What a machine has room for: the bytes it could give without swapping,
 * and the share of the last ten seconds some task waited
 * for memory (PSI `some avg10`, a percentage). */
export type Room = { available: number; pressure: number }

/** What one more run needs of a machine, and how long a run admitted holds a
 * reservation before the machine's own reading counts it. */
export type Need = {
  /** bytes a run takes at its peak */
  memory: number
  /** the memory pressure (PSI `some avg10`) at or past which nothing starts */
  pressure: number
  /** ms a run admitted is reserved for: it starts small and grows */
  settle: number
}

/** A run on the box peaked at 3.6 GB (memory and swap) at p90 over 135 runs
 * (T-1463): its test run, not its agent. It reaches that within minutes. */
export let NEED: Need = { memory: 4 * 1024 ** 3, pressure: 10, settle: 300_000 }

/** Read the machine's pressure, then its memory, in one control call. In a
 * container the cgroup mount root covers the machine's work, including runs
 * outside the caller's own service cgroup. */
export let SCRIPT = `cgroup=/sys/fs/cgroup
pressure=$(cat "$cgroup/memory.pressure" 2>/dev/null) || pressure=''
case "$pressure" in
  'some avg10='*) printf '%s\\n' "$pressure" ;;
  *) cat /proc/pressure/memory || exit ;;
esac
if read -r limit 2>/dev/null <"$cgroup/memory.max" &&
   read -r current 2>/dev/null <"$cgroup/memory.current"; then
  printf 'CgroupMemory: %s %s\\n' "$limit" "$current"
fi
cat /proc/meminfo || exit`

let mem = (text: string, field: string): number | undefined => {
  let kb = text.match(new RegExp(`^${field}:[ \\t]+(\\d+) kB$`, 'm'))
  if (kb) return Number(kb[1]) * 1024
}

let available = (text: string): number => {
  let reported = mem(text, 'MemAvailable')
  if (reported != null) return reported
  let free = mem(text, 'MemFree')
  if (free != null) {
    let cache = (mem(text, 'Buffers') ?? 0) + (mem(text, 'Cached') ?? 0)
    return free + Math.max(0, cache - (mem(text, 'Shmem') ?? 0))
  }
  let group = text.match(/^CgroupMemory: (max|\d+) (\d+)$/m)
  let total = mem(text, 'MemTotal')
  let limit = group && group[1] != 'max' ? Number(group[1]) : total
  if (group && limit != null) return Math.max(0, limit - Number(group[2]))
  if (total != null) return 0
  throw new Error('Machine memory reading is missing')
}

/** Read a machine's room from what {@link SCRIPT} prints. */
export let roomOf = (text: string): Room => {
  let some = text.match(/^some[ \t]+avg10=(\d+(?:\.\d+)?)(?:[ \t]|$)/m)
  if (!some) {
    throw new Error('Machine memory pressure (PSI some avg10) is missing')
  }
  return { available: available(text), pressure: Number(some[1]) }
}

/** Read a computer's room through its transport. */
export let room = async (transport: ComputerTransport): Promise<Room> =>
  roomOf(await transport.execute(SCRIPT))

/** Whether one more run fits, with `held` runs admitted but not yet grown. */
export let fits = (r: Room, need: Need = NEED, held = 0): boolean =>
  r.pressure < need.pressure &&
  r.available - held * need.memory >= need.memory

/**
 * Admits runs on one machine while it has room: each call reads the room and
 * answers whether a run may start now, reserving its need for `settle` ms.
 * Calls are answered one at a time, so a burst of starts sees its own
 * reservations.
 *
 * ```ts
 * import { admitter } from '@yaks/machine/room'
 *
 * let admit = admitter(() =>
 *   Promise.resolve({ available: 9 * 1024 ** 3, pressure: 0 })
 * )
 * console.assert(await admit() && await admit() && !await admit())
 * ```
 */
export let admitter = (
  read: () => Promise<Room>,
  need: Need = NEED,
  now: () => number = Date.now,
): () => Promise<boolean> => {
  let held: number[] = []
  let turn: Promise<unknown> = Promise.resolve()
  let admit = async () => {
    let t = now()
    held = held.filter((at) => t - at < need.settle)
    if (!fits(await read(), need, held.length)) return false
    held.push(t)
    return true
  }
  return () => {
    let answer = turn.then(admit)
    turn = answer.catch(() => {})
    return answer
  }
}

/** The {@link admitter} of the computer this process runs on. */
export let here = (need: Need = NEED): () => Promise<boolean> =>
  admitter(async () => room(await localConnector().connect('local://')), need)
