// A process's own time: the wall clock less what the box kept it, or any
// process it started, waiting for a CPU. Linux keeps, for each thread, the
// time it ran on a CPU and the time it waited, runnable, for one
// (/proc/<pid>/task/<tid>/schedstat), and lists the children each thread
// started (/proc/<pid>/task/<tid>/children). A wait timed by its own time
// fails when what it waits on hangs, never because the box is busy: a process
// that stops (a deadlock, a lost wakeup) waits for no CPU, so its own time
// keeps the wall clock's pace.

/** What each thread of `pid` and of every process it started has waited for
 * a CPU so far, in ms, by the thread's path under /proc. Empty where the
 * platform does not say. */
export let waits = (pid: number): Map<string, number> => {
  let found = new Map<string, number>()
  let visit = (pid: number) => {
    for (let task of tasks(pid)) {
      let at = `/proc/${pid}/task/${task}`
      let wait = Number(read(`${at}/schedstat`)?.split(' ')[1]) / 1e6
      if (Number.isFinite(wait)) found.set(at, wait)
      for (let child of read(`${at}/children`)?.split(' ') ?? []) {
        if (child) visit(Number(child))
      }
    }
  }
  visit(pid)
  return found
}

// A process or thread that ended between two reads has nothing to say, and
// neither does a platform without /proc or a runtime not let read it.
let gone = (error: unknown) =>
  error instanceof Deno.errors.NotFound ||
  error instanceof Deno.errors.NotCapable ||
  error instanceof Deno.errors.PermissionDenied ||
  (error as { code?: string }).code == 'ESRCH'
let read = (path: string): string | undefined => {
  try {
    return Deno.readTextFileSync(path)
  } catch (error) {
    if (gone(error)) return undefined
    throw error
  }
}
let tasks = (pid: number): string[] => {
  try {
    return [...Deno.readDirSync(`/proc/${pid}/task`)].map((e) => e.name)
  } catch (error) {
    if (gone(error)) return []
    throw error
  }
}

/** How {@link own} looks: how often, at what, and by which clock. */
export type Looks = {
  /** ms before the first look and between looks; a reading in between keeps
   * the wall clock's pace */
  every?: number
  /** what each thread has waited for a CPU so far, in ms */
  look?: (pid: number) => Map<string, number>
  /** the wall clock, in ms */
  time?: () => number
}

/** A clock of `pid`'s own time, in ms since the clock was made: the wall
 * clock's pace, less what the box kept the process, or any process it
 * started, waiting for a CPU. Between two looks the box held them at least as
 * long as their most-held thread waited, so that is what each look takes off.
 * The first look is `every` ms in and the span before it counts whole, so a
 * clock read only sooner never looks. Where the platform does not say, it is
 * the wall clock (the README has an example). */
export let own = (
  pid: number = Deno.pid,
  { every = 250, look = waits, time = () => performance.now() }: Looks = {},
): () => number => {
  let start = time()
  let at = start
  let was: Map<string, number> | undefined
  let held = 0
  let last = 0
  return () => {
    let now = time()
    if (now - at >= every) {
      let is = look(pid)
      let most = 0
      for (let [thread, wait] of was ? is : []) {
        most = Math.max(most, wait - (was!.get(thread) ?? 0))
      }
      held += most
      was = is
      at = now
    }
    // Linux brings a thread's wait up to date only once it is back on a CPU,
    // so a look can take off a wait the clock already counted. A clock never
    // runs back.
    return last = Math.max(last, now - start - held)
  }
}
