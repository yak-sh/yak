#!/usr/bin/env -S deno run -A
// The runner: every test module and example page it is given, loaded into
// this one runtime a file at a time, each file's tests run as it loads.
//
//   main.ts [--tag=t]... [--platform=p] [--all] [--also=path]...
//     [--timeout=ms] path...
//
// A path is a test module (`*_test.ts`), a page whose examples run (a module
// or a Markdown page), or a directory holding them. `--tag` keeps the tests
// carrying every tag named, and `--platform` is a tag every test here
// carries. A file whose tests all passed, with nothing it depends on changed
// since (./deps.ts), is left out unless `--all` is given; `--also` names
// what every file depends on beside its own graph. A test that has not ended
// within `--timeout` fails, and the run goes on. The exit code is 1 when a
// test failed.
import { keys, passed, remember } from './deps.ts'
import { find } from './find.ts'
import { examples, plan, sweep } from './load.ts'
import { file, type Outcome, summary } from './run.ts'
import { collect, from, type Test, test } from './suite.ts'

let FLAGS = /^--(tag|platform|also|timeout)=(.*)$|^--(all)$/
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
let paths = Deno.args.filter((a) => !a.startsWith('--'))
let started = performance.now()
let here = (path: string) => new URL(path, `file://${Deno.cwd()}/`).href
let exists = (path: string) => Deno.stat(path).then(() => true, () => false)

let { tests: modules, pages } = await find(paths)
await sweep(pages)

// What each file depends on, keyed; a page by the plan standing for it.
let plans = await plan(pages)
let as = new Map(plans.map(([page, planned]) => [planned, page]))
let key = new Map<string, string>()
try {
  let runner = new URL('./main.ts', import.meta.url).pathname
  let also = [
    runner.replace(`${Deno.cwd()}/`, ''),
    ...(await Promise.all(
      ['deno.json', 'deno.jsonc', 'deno.lock'].map(async (f) =>
        await exists(f) ? [f] : []
      ),
    )).flat(),
    ...flag('also'),
  ]
  let salt = `${Deno.version.deno} ${platform}`
  let found = await keys([...modules, ...as.keys()], { also, salt, as })
  for (let [root, k] of found) key.set(as.get(root) ?? root, k)
} finally {
  await Promise.all([...as.keys()].map((p) => Deno.remove(p).catch(() => {})))
}
let before = all ? {} : passed()
let fresh = (path: string) => !((key.get(path) ?? '') in before)
let left = [...modules, ...pages].filter((p) => !fresh(p)).length

let planned = performance.now() - started
let loading = 0

let collected = collect()
let chosen = (t: Test) => tags.every((tag) => t.tags.includes(tag))
let outcomes: Outcome[] = []
let run = async (path: string, load: () => Promise<unknown>) => {
  let at = collected.length
  let begun = performance.now()
  from(path)
  try {
    await load()
  } catch (error) {
    test(`${path} loads`, () => {
      throw error
    })
  }
  let loaded = performance.now() - begun
  loading += loaded
  let tests = collected.slice(at).filter(chosen)
  outcomes.push(...await file(path, tests, timeout, loaded))
}
for (let m of modules.filter(fresh)) await run(m, () => import(here(m)))
for (let p of pages.filter(fresh)) await run(p, () => examples(p))

// A file passed when every test it declared ran and passed; a run that
// picked by tag ran only some.
if (!tags.length) {
  let failed = new Set(outcomes.filter((o) => !o.ok).map((o) => o.test.file))
  remember(
    [...modules, ...pages].filter((p) => fresh(p) && !failed.has(p))
      .flatMap((p) => key.get(p) ?? []),
  )
}
summary(outcomes, performance.now() - started, { left, planned, loading })
Deno.exit(outcomes.some((o) => !o.ok) ? 1 : 0)
