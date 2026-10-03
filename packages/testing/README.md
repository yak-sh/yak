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

## A complete run

This example writes a test module and runs it with the runner. The suite's
clauses inherit its tag; `it.skip` declares a skipped test. The temporary files
and the runner's pass record are removed afterwards.

```ts
import { equal, match } from '@yaks/testing'

let dir = await Deno.makeTempDir({ prefix: 'testing-example-' })
try {
  let testing = import.meta.resolve('@yaks/testing')
  await Deno.writeTextFile(
    `${dir}/sum_test.ts`,
    `
    import { test, suite, equal } from ${JSON.stringify(testing)}
    test('two and two', () => equal(2 + 2, 4), { tags: ['math'] })
    suite('sum', ({ it, equal }) => {
      it('adds', () => equal([1, 2].reduce((a, b) => a + b, 0), 3))
      it.skip('later', () => { throw new Error('skipped') })
    }, { tags: ['math'] })
  `,
  )
  let run = async (flags: string[]) => {
    let result = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        import.meta.resolve('@yaks/testing/main'),
        ...flags,
        dir,
      ],
      env: { XDG_CACHE_HOME: `${dir}/cache` },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    equal(result.code, 0, new TextDecoder().decode(result.stderr))
    return new TextDecoder().decode(result.stdout)
  }
  match(await run(['--tag=math', '--platform=deno']), /2 passed.*1 ignored/)
  match(await run([]), /2 passed.*1 ignored/)
  match(await run([]), /1 unchanged since they passed/)
  match(await run(['--all']), /2 passed.*1 ignored/)
} finally {
  await Deno.remove(dir, { recursive: true })
}
```

## Exports

| Export               | Provides                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@yaks/testing`      | `test`, `suite`, `equal`, `ok`, `match`, `throws`, `tick`, `until`; types `Test`, `Options`, `It`, `Spec`, `Wait` |
| `@yaks/testing/find` | `tested`, `paged`, `walk`, `examples`, `find`                                                                     |
| `@yaks/testing/main` | The Deno runner entry point                                                                                       |

## Declaring tests

`test(name, body, { tags, skip })` declares a test. `suite(name, body, options)`
passes `it` and the assertions to its body. Each clause's name starts with the
suite's name, its tags combine with the suite's tags, and either one's `skip`
skips the clause. If a suite's body throws while declaring tests, it declares a
failing test instead.

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
accepts `timeout` (default 2000 ms), `poll` (default 5 ms), and a `label` for
the timeout error. A label function is evaluated when the timeout occurs.

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
let dir = await Deno.makeTempDir({ prefix: 'testing-find-' })
try {
  await Deno.writeTextFile(`${dir}/sum_test.ts`, '')
  await Deno.writeTextFile(`${dir}/README.md`, source)
  equal(await walk([dir, dir]), [`${dir}/README.md`, `${dir}/sum_test.ts`])
  equal(await find([dir]), {
    tests: [`${dir}/sum_test.ts`],
    pages: [`${dir}/README.md`],
  })
} finally {
  await Deno.remove(dir, { recursive: true })
}
```

## Running

```sh
deno run -A jsr:@yaks/testing/main [--tag=t]... [--platform=p] [--all] \
  [--also=path]... [--timeout=ms] path...
```

A path names a test module, a page, or a directory holding them. Files load one
at a time; each file's tests run before the next file loads. A file that cannot
load fails as a test. A test that exceeds `--timeout` (default 50000 ms) fails
and the runner continues; the timeout does not cancel its body. A failed test
sets exit code 1; an unknown flag sets exit code 2.

`--tag` selects tests carrying every named tag; comma-separated tags are also
accepted. `--platform` supplies the runtime's tag, so selecting that tag keeps
all tests in the runtime.

A file whose tests all passed is skipped while its dependencies are unchanged:
its module dependencies resolved by `deno info`, files named with a literal
`new URL('./fixture.json', import.meta.url)`, the runner, config, lock, Deno
version and paths supplied by `--also`. Directories named this way track the
place, not its contents. The pass record is
`$XDG_CACHE_HOME/yak/tests-passed.json`, or `~/.cache/yak/tests-passed.json`
when `XDG_CACHE_HOME` is unset, shared by checkouts on the machine. `--all`
bypasses it; a run filtered by tag records no passes.

In this repository, `deno task test` starts one runner runtime per platform:
deno, browser, terminal and workerd.

## Limits

Assertions and waiting work in runtimes with timers. Without `Deno.test` or the
runner, declaring tests does not execute them. The runner and discovery
functions need Deno. The runner uses `deno info` for dependencies and `/proc` to
identify temporary examples left by ended processes. Files read in ways other
than the dependency forms above are not tracked: include them with `--also` or
use `--all`.
