// Per-file wall clocks, including cold process/module startup, under bounded
// contention. Diagnostic only: these do not sum to the sharded suite's clock.
// deno run -A bin/test-profile.ts /tmp/fleet-profile [jobs=4]
import { inventory } from './test.ts'

let [directory, count = '4'] = Deno.args
let jobs = Number(count)
if (!directory || !Number.isInteger(jobs) || jobs < 1) {
  throw new Error('usage: test-profile.ts OUTPUT_DIRECTORY [JOBS=4]')
}
await Deno.mkdir(directory, { recursive: true })
let files = await inventory()
let at = 0
let rows: { file: string; seconds: number; code: number }[] = []
let load = () => Deno.readTextFileSync('/proc/loadavg').trim()
let started = { at: new Date().toISOString(), load: load() }
await Promise.all(
  Array.from({ length: Math.min(jobs, files.length) }, async () => {
    while (at < files.length) {
      let file = files[at++]
      let start = performance.now()
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'test',
          '--frozen',
          '--no-check',
          '-A',
          '--unstable-net',
          '--unstable-worker-options',
          file,
        ],
        env: {
          DB_PATH: ':memory:',
          TASKS_SYNC: 'off',
          TASKS_EMBED: '0',
          TASKS_BACKOFF: '',
          NO_COLOR: '1',
        },
      }).output()
      let row = {
        file,
        seconds: (performance.now() - start) / 1000,
        code: out.code,
      }
      rows.push(row)
      await Deno.writeFile(
        `${directory}/${file.replaceAll('/', '_')}.log`,
        out.stdout,
      )
      await Deno.writeFile(
        `${directory}/${file.replaceAll('/', '_')}.log`,
        out.stderr,
        { append: true },
      )
      console.log(JSON.stringify(row))
    }
  }),
)
await Deno.writeTextFile(
  `${directory}/results.json`,
  JSON.stringify(
    {
      deno: Deno.version.deno,
      jobs,
      started,
      ended: { at: new Date().toISOString(), load: load() },
      files: rows.sort((a, b) => b.seconds - a.seconds),
    },
    null,
    2,
  ) + '\n',
)
if (rows.some((row) => row.code !== 0)) Deno.exitCode = 1
