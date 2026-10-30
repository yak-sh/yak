#!/usr/bin/env -S deno run -A
// The runner: every test module and example page it is given, loaded into
// this one runtime a file at a time, each file's tests run as it loads.
//
//   main.ts [--tag=t]... [--platform=p] [--all] [--also=path]... [--keys=file]
//     [--timeout=ms] [--times=dir] [--verbose] path...
//
// A path is a test module (`*_test.ts`), a page whose examples run (a module
// or a Markdown page), or a directory holding them. `--tag` keeps the tests
// carrying every tag named, and `--platform` is a tag every test here
// carries. A file whose pass is kept, nothing it depends on changed since
// (./deps.ts), is left out unless `--all` is given; `--also` names what every
// file depends on beside its own graph. `--keys` names a JSON file holding
// the key of each file given, from a caller that chose them already
// (./choose.ts): every file given runs. The runner observes file reads and
// module-loading boundaries as it runs
// (./reads.ts), and keeps a pass by that too.
//
// A test that has not ended within `--timeout` of its own time fails, and the
// run goes on (./run.ts `one`).
// `--times` writes what each test and each file's load took, and the proof
// of each file the run remembered as passed, to `<dir>/<platform>.json`.
//
// Each test is said as it runs, a failure's error right after it, and the
// closing report says every failure again; each error is cut short (./run.ts
// `brief`) unless `--verbose`. The exit code is 1 when a test failed.
import { choose } from './choose.ts'
import { drive } from './drive.ts'
import { note, proof, remember, survey } from './deps.ts'
import { find, tested } from './find.ts'
import { examples } from './load.ts'
import { observe } from './reads.ts'
import { summary, timed } from './run.ts'
import { collect, from, type Test, test } from './suite.ts'

// Before anything a test could start inherits it.
Deno.env.delete('DENO_AUDIT_PERMISSIONS')
let observation = observe()

let FLAGS = /^--(tag|platform|also|keys|timeout|times)=(.*)$|^--(all|verbose)$/
let odd = Deno.args.find((a) => a.startsWith('--') && !FLAGS.test(a))
if (odd) {
  console.error(`main.ts: the runner has no flag ${odd}`)
  Deno.exit(2)
}
let flag = (name: string) =>
  Deno.args.map((a) => a.match(FLAGS)).filter((m) => m?.[1] == name)
    .map((m) => m![2])
let platform = flag('platform').at(-1) ?? ''
// Every test here carries the platform's tag, so naming it picks them all.
let tags = flag('tag').flatMap((t) => t.split(','))
  .filter((t) => t && t != platform)
let timeout = Number(flag('timeout').at(-1) ?? 50_000)
let all = Deno.args.includes('--all')
let verbose = Deno.args.includes('--verbose')
let paths = Deno.args.filter((a) => !a.startsWith('--'))
let given = flag('keys').at(-1)
let started = performance.now()
let here = (path: string) => new URL(path, `file://${Deno.cwd()}/`).href
let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)

// The files given, or found under the paths, and the key of each.
let { tests: found, pages: shown } = given
  ? { tests: paths.filter(tested), pages: paths.filter((p) => !tested(p)) }
  : await find(paths)
let chosen = given
  ? {
    keys: new Map(Object.entries(JSON.parse(await Deno.readTextFile(given)))),
    run: [...found, ...shown],
  }
  : await choose([...found, ...shown], {
    all,
    observed: true,
    kind: () => platform,
    also: () => ['deno.json', 'deno.jsonc', 'deno.lock', ...flag('also')],
    runner: [
      new URL('./run.ts', import.meta.url).pathname.replace(
        `${Deno.cwd()}/`,
        '',
      ),
    ],
  })
let key = chosen.keys as Map<string, string>
let running = new Set(chosen.run)
let modules = found.filter((m) => running.has(m))
let pages = shown.filter((p) => running.has(p))
let left = found.length + shown.length - running.size

let planned = performance.now() - started
let collected = collect()
let picked = (t: Test) => tags.every((tag) => t.tags.includes(tag))
let load = async (path: string) => {
  let at = collected.length
  observation.mark(path)
  from(path)
  try {
    await (tested(path) ? import(here(path)) : examples(path))
  } catch (error) {
    test(`${path} loads`, () => {
      throw error
    })
  }
  return collected.splice(at).filter(picked)
}
// Examples load before test modules, while the runtime's import graph is small.
let { outcomes, loading, loads } = await drive([...pages, ...modules], load, {
  timeout,
  verbose,
})

// A file passed when every test it declared ran and passed; a run that
// picked by tag ran only some. Its pass is kept by its proof: its key, and
// what it read as it ran, as that is now.
let failed = new Set(outcomes.filter((o) => !o.ok).map((o) => o.test.file))
let passing = tags.length
  ? []
  : [...modules, ...pages].filter((p) => !failed.has(p) && key.has(p))
let seen = observation.reads()
observation.close()
let read = (p: string) => seen && (seen.get(p) ?? [])
let s = await survey([
  ...new Set(passing.flatMap((p) => read(p) ?? []).filter(code)),
])
let remembered: Record<string, string> = s
  ? Object.fromEntries(
    await Promise.all(
      passing.map(async (p) => [p, await proof(s, key.get(p)!, read(p), true)]),
    ),
  )
  : {}
remember(Object.values(remembered))
if (seen && s) {
  note(Object.fromEntries(passing.map((p) => [key.get(p)!, read(p)!])))
}
let wall = performance.now() - started
summary(outcomes, wall, { left, planned, loading }, verbose)
let times = flag('times').at(-1)
if (times) {
  await Deno.mkdir(times, { recursive: true })
  await Deno.writeTextFile(
    `${times}/${platform || 'tests'}.json`,
    JSON.stringify(
      timed(outcomes, { wall, planned, loading, loads, remembered, left }),
    ),
  )
}
Deno.exit(outcomes.some((o) => !o.ok) ? 1 : 0)
