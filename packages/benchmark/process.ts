/** CPU used by an external process tree. Process CPU clocks include every
 * thread at nanosecond precision; proc supplies descendants and reaped work. */
let library = () =>
  Deno.dlopen('libc.so.6', {
    clock_gettime: { parameters: ['i32', 'buffer'], result: 'i32' },
    sysconf: { parameters: ['i32'], result: 'i64' },
  })
let clocks: ReturnType<typeof library> | undefined
let times = new BigInt64Array(2)

export let processCpu = (pid: number): number => {
  if (Deno.build.os != 'linux') throw new Error('Process CPU clocks need Linux')
  clocks ??= library()
  let ticks = Number(clocks.symbols.sysconf(2))
  let seen = new Set<number>()
  let read = (id: number): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    let stat: string
    try {
      stat = Deno.readTextFileSync(`/proc/${id}/stat`)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return 0
      throw error
    }
    let fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    let result = clocks!.symbols.clock_gettime((~id << 3) | 2, times)
    let own = result == 0
      ? Number(times[0]) * 1000 + Number(times[1]) / 1e6
      : (Number(fields[11]) + Number(fields[12])) * 1000 / ticks
    let children = new Set<number>()
    for (let task of Deno.readDirSync(`/proc/${id}/task`)) {
      try {
        for (
          let child of Deno.readTextFileSync(
            `/proc/${id}/task/${task.name}/children`,
          ).trim().split(/\s+/).filter(Boolean)
        ) children.add(Number(child))
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error
      }
    }
    return own + (Number(fields[13]) + Number(fields[14])) * 1000 / ticks +
      [...children].reduce((total, child) => total + read(child), 0)
  }
  return read(pid)
}
