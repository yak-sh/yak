# @yaks/testing

Declare tests, check their results, and run test modules and examples in one
runtime. The runner skips files whose dependencies have not changed since they
passed.

An **assertion** checks a value and throws when it does not meet the
expectation. A **test** is a named function that fails by throwing or rejecting.
A **test module** is a file named `*_test.ts` (also `.js`, `.tsx`, `.jsx`,
`.mts`, `.mjs`, `.cts` or `.cjs`) that declares tests. A **suite** groups tests
under one name and supplies assertions to its body. A **tag** is a string used
to select tests, such as `'math'`.

An **example** is code in a Markdown fence, a module's doc comment fence, or a
module's doctest. A **doctest** is a `///` line that checks an expression or
declares a statement shared by the module's doctests. A **page** is a Markdown
file or a module containing examples. The **runner** is `@yaks/testing/main`: it
loads test modules and pages and runs their tests in one runtime.

## A complete test module

A module declares behavior through `test` or `suite`. The suite's clauses
inherit its tag; `it.skip` declares a skipped test.

```ts
import { equal, suite, test } from '@yaks/testing'

test('two and two', () => equal(2 + 2, 4), { tags: ['math'] })
suite('sum', ({ it, equal }) => {
  it('adds', () => equal([1, 2].reduce((a, b) => a + b, 0), 3))
  it.skip('later', () => {
    throw new Error('skipped')
  })
}, { tags: ['math'] })
```

From this repository, `deno task test` selects tests through the dependency
graph, including consumers and examples. It applies formatting to changed files,
lints changed code, and type checks affected source modules, tests and their doc
comment fences. Markdown examples run as tests without a separate type check.
Passing test caches do not skip source type checks. Paths and tags narrow a run
while iterating; the finished change uses the no-path command to include its
consumers. Tests run in process; page behavior uses linkedom, and terminal
behavior uses @yaks/tui's `lay`. There are no browser tests or slow platform
tier.

## Exports

| Export                 | Provides                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@yaks/testing`        | `test`, `suite`, `equal`, `ok`, `match`, `throws`, `tick`, `until`, `clock`, `own`, `waits`; types `Test`, `Options`, `It`, `Spec`, `Wait`, `Clock`, `Looks` |
| `@yaks/testing/own`    | `own`, `waits`, `held`, `started`: a process's own time, for a coordinator that imports no tests                                                             |
| `@yaks/testing/find`   | `tested`, `paged`, `walk`, `examples`, `find`                                                                                                                |
| `@yaks/testing/choose` | `choose`: which of a run's files run, and each one's key                                                                                                     |
| `@yaks/testing/deps`   | `survey`, `key`, `shared`, `proof`, `seal`, `digest`, `named`, `graph`; the pass record: `passed`, `remember`, `forget`, `recall`, `note`                    |
| `@yaks/testing/reads`  | `AUDIT`, `audit`, `mark`, `reads`, `audited`, `path`: what each file read as it ran                                                                          |
| `@yaks/testing/main`   | The Deno runner entry point                                                                                                                                  |

## Declaring tests

`test(name, body, { tags, skip })` declares a test. `suite(name, body, options)`
passes `it` and the assertions to its body. Each clause's name starts with the
suite's name, its tags combine with the suite's tags, and either one's `skip`
skips the clause. If a suite's body throws while declaring tests, it declares a
failing test instead.

`cleanup(done)` asks for `done` once the running test ends, last asked first,
inside the test's time: a fixture that opens something closes it there, and
nothing it left running reaches the next test. A cleanup that throws fails the
test.

Outside the runner, declarations register with `Deno.test` when it is available.
In a runtime without `Deno.test`, declarations need the runner's collection
mechanism to be executed.

## Assertions

An **assertion** checks a value and throws when it does not meet the
expectation. `equal` checks deep equality, `ok` checks truthiness, and `match`
checks a partial pattern. Each returns the checked value. `throws` awaits a
function, checks that it throws or rejects, and returns the error. Its optional
message is a substring or a regular expression.

```ts
import { equal, match, ok, throws } from '@yaks/testing'

equal({ values: [1, 2] }, { values: [1, 2] })
equal(ok([1, 2].find((n) => n == 2)), 2)
let person = { name: 'Ada', tags: ['a', 'b'], born: new Date(0) }
equal(match(person, { name: /^A/, tags: ['a'], born: Date }), person)
let error = await throws(async () => {
  throw new Error('unclosed quote')
}, /quote/)
match(error, Error)
```

A `match` pattern checks the keys it names and array items at their indices.
Regular expressions check a value's text; classes check instances. Empty objects
and arrays require empty values. Other values, including class instances and
arrow functions, compare by deep equality.

## Waiting

`tick` yields one macrotask. `until` polls a function until its return value is
truthy, then returns that value; a rejected or thrown error propagates. It
accepts `timeout` (default 2000 ms), `poll` (default 5 ms), a `label` for the
timeout error, and the `clock` it keeps both by: by default the test's own time
(below) and the runtime's timers, or a test's own (see
[Controlling time](#controlling-time)). A label function is evaluated when the
timeout occurs.

```ts
import { equal, throws, tick, until } from '@yaks/testing'

let ready = ''
setTimeout(() => ready = 'ready')
await tick()
equal(await until(() => ready, { label: 'ready' }), 'ready')
let attempts = 0
await throws(() =>
  until(() => ++attempts && false, {
    timeout: 0,
    label: () => `${attempts} attempts`,
  }), '1 attempts')
```

A timeout counts the test's **own time**: the wall clock less what the box kept
the test's runtime, and every process it started, waiting for a CPU. `own(pid)`
is that clock for a process and every process it started (this one by default),
read from Linux's /proc; elsewhere it is the wall clock. A wait on something
that hangs (a server that never answers, a child that stopped) waits for no CPU,
so its own time keeps the wall clock's pace and the wait still fails; one only
slowed by a busy box is given the time it would have taken alone. Between two
looks, the box held the processes at least as long as their most-held thread
waited, and that is what each look takes off. The first look is 250 ms into a
wait (`every`) and the span before it counts whole, so a wait that ends sooner
costs nothing. `waits(pid)` is what a look reads: each thread's wait so far, in
ms.

```ts
import { equal, own } from '@yaks/testing'

// What a thread has waited at each look, and the wall clock at each reading.
let looks = [new Map([['main', 0]]), new Map([['main', 30]])]
let times = [0, 0, 100]
let now = own(Deno.pid, {
  every: 0,
  look: () => looks.shift()!,
  time: () => times.shift()!,
})
equal(now(), 0) // the first look
equal(now(), 70) // 100 ms passed, 30 of them waiting for a CPU
```

## Examples beside the code

Fenced `ts` blocks in Markdown and doc comments run as tests. The runner also
accepts `tsx`, `js`, `jsx`, `mjs`, `mts`, `typescript` and `javascript` fences.
A fence marked `ignore` is skipped. In a module's doc comment, its exports are
available without imports.

A doctest's `->` checks equality, `~>` awaits its input and checks a partial
pattern, and `throws` checks an error message. A line without an operator is a
shared statement. A line indented past the first continues that doctest; `// /`
skips a doctest.

This example runs all three doctest checks and a doc comment fence:

```ts
import { equal, match } from '@yaks/testing'

let dir = await Deno.makeTempDir({ prefix: 'testing-doctests-' })
try {
  await Deno.writeTextFile(
    `${dir}/twice.ts`,
    `
    /// let n = 2
    /// twice(n) -> 4
    /// Promise.resolve({ answer: twice(n), extra: true }) ~> { answer: 4 }
    /// JSON.parse('{') throws 'JSON'
    /**
     * \`\`\`ts
     * import { equal } from ${
      JSON.stringify(import.meta.resolve('@yaks/testing'))
    }
     * equal(twice(3), 6)
     * \`\`\`
     */
    export let twice = (n: number) => n * 2
  `,
  )
  let result = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      import.meta.resolve('@yaks/testing/main'),
      '--all',
      dir,
    ],
    env: { XDG_CACHE_HOME: `${dir}/cache` },
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  equal(result.code, 0, new TextDecoder().decode(result.stderr))
  match(new TextDecoder().decode(result.stdout), /4 passed.*0 failed/)
} finally {
  await Deno.remove(dir, { recursive: true })
}
```

Each example is compiled to a temporary module beside its page, preserving
relative import resolution and line numbers, and removed after loading.

## Finding tests and pages

`tested` recognizes test module paths. `paged` recognizes module and Markdown
paths except test modules. `examples` checks source for examples that run.
`walk` returns sorted, unique files under paths; directory traversal skips
hidden entries, `vendor`, `node_modules` and `.wrangler`. `find` returns test
modules and pages with examples that run.

```ts
import { equal } from '@yaks/testing'
import { examples, find, paged, tested, walk } from '@yaks/testing/find'

equal(tested('sum_test.ts'), true)
equal(paged('README.md'), true)
let source = `${'`'.repeat(3)}ts\n1 + 1\n${'`'.repeat(3)}`
equal(examples('README.md', source), true)
let dir = Deno.makeTempDirSync({ prefix: 'testing-find-' })
try {
  Deno.writeTextFileSync(`${dir}/sum_test.ts`, '')
  Deno.writeTextFileSync(`${dir}/README.md`, source)
  equal(await walk([dir, dir]), [`${dir}/README.md`, `${dir}/sum_test.ts`])
  equal(await find([dir]), {
    tests: [`${dir}/sum_test.ts`],
    pages: [`${dir}/README.md`],
  })
} finally {
  Deno.removeSync(dir, { recursive: true })
}
```

## Running

```sh
deno run -A jsr:@yaks/testing/main [--tag=t]... [--platform=p] [--all] \
  [--also=path]... [--keys=file] [--timeout=ms] [--times=dir] [--verbose] path...
```

A path names a test module, a page, or a directory holding them. Files load one
at a time; each file's tests run before the next file loads. A file that cannot
load fails as a test. A test that exceeds `--timeout` (default 50000 ms) of its
own time (`own`: the runtime's and every process it started) fails and the
runner continues; the timeout does not cancel its body. A failed test sets exit
code 1; an unknown flag sets exit code 2.

The runner says each test as it runs (`adds ... ok (120µs)`), a failed test's
errors right after its line, so a runtime that dies before it ends has still
said them, then a closing report: each failed test's name and file with its
errors again, then the counts. An error keeps only the stack frames in the
current directory, named from it, and none of this package's own, and is cut to
30 lines. `--verbose` says each error whole, names the failures again, and says
what planning and loading took.

`--tag` selects tests carrying every named tag; comma-separated tags are also
accepted. `--platform` supplies the runtime's tag, so selecting that tag keeps
all tests in the runtime. `--times` writes what the run took, in milliseconds,
to `<dir>/<platform>.json` (`tests.json` without a platform): the whole run, its
planning and loading, each file's load, each test that ran with its file, name,
wall time (`ms`), CPU time (`cpu`) and whether it passed. CPU time includes
every thread's user and system time and reaped child processes, from the shared
benchmark clock. Waiting for timers, I/O or a CPU contributes no CPU time. The
per-test performance budget uses `cpu`; wall time remains diagnostic. Existing
budget records are marked `legacy-wall-ceilings`: retained upper bounds that
`--write` lowers using CPU samples. The report also records each file the run
remembered as passed, with its proof in the pass record (`forget` from
`@yaks/testing/deps` takes one back), and how many tests it skipped and files it
left out as unchanged.

A file whose tests all passed is skipped while its dependencies are unchanged.
Its **key** holds what it depends on before it runs: its module dependencies
resolved by `deno info`, files named with a literal
`new URL('./fixture.json', import.meta.url)`, the runner (by what loads with it,
not a module it imports only when a run asks for it), config, lock, Deno version
and paths supplied by `--also`. A directory named this way is a place, not its
contents, and a directory's listing leaves out what the runner writes beside a
page while it runs. Started with `DENO_AUDIT_PERMISSIONS` naming a file, the
runner also sees what each file reads as it runs: a directory it walks (its
listing), a file at a path it computes, a module it imports by a computed
specifier (with that module's whole graph). A pass is then kept by its
**proof**: the key, and what each of those holds. The runner takes the variable
out of its environment before any test runs, since a Deno child that inherited
it would empty the file; what a child process reads is not seen. The pass record
is `$XDG_CACHE_HOME/yak/tests-passed.json`, or `~/.cache/yak/tests-passed.json`
when `XDG_CACHE_HOME` is unset, shared by checkouts on the machine, and what
each key's file read is kept beside it in `tests-read.json`. `--all` bypasses
the record; a run filtered by tag records no passes. `--keys` names a JSON file
holding the key of each file given, from a caller that chose them already
(`choose` from `@yaks/testing/choose`): every file given runs.

In this repository, `deno task test` chooses what runs before it starts
anything, then starts one runner runtime for each platform holding a file that
runs (deno and terminal), each auditing into a file of its own.

## Controlling time

A **virtual clock** runs scheduled callbacks when a test advances time. Inject
`clock()`'s `now` and `after` into the code's timer boundary.
`after(ms, callback)` returns a cancellation function. `advance(ms)` first turns
the event loop once, so work the caller queued sets its timers, then awaits
callbacks in chronological order, including callbacks scheduled by callbacks;
callbacks at the same time run in registration order. `pending()` counts the
callbacks set that have neither run nor been cancelled. It leaves global timers
and `Date` unchanged.

Code that reads the time or sets a timer takes a clock (@yaks/fp `Clock`, the
runtime's `system` by default), and a test hands it one of its own. A test never
replaces the runtime's clock or timers, with @std/testing's `FakeTime`, a stub
of `setTimeout` or an assignment to `Date.now`: every test file in a run shares
one runtime, and a faked global counts, moves and swallows timers that other
files started, so the verdict depends on which files ran first.

```ts
import { clock, equal } from '@yaks/testing'

let time = clock(100)
let expired = false
time.after(20, () => {
  expired = true
})
await time.advance(19)
equal(expired, false)
await time.advance(1)
equal([expired, time.now()], [true, 120])
```

## Limits

Assertions and waiting work in runtimes with timers. Without `Deno.test` or the
runner, declaring tests does not execute them. The runner and discovery
functions need Deno. The runner uses `deno info` for dependencies and `/proc` to
identify temporary examples left by ended processes. Without the audit, files
read in ways other than the dependency forms above are not tracked; with it,
what a child process reads still is not: include those with `--also` or use
`--all`.
