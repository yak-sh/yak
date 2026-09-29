# @yaks/testing

Declare tests, say what they expect, and run them in one runtime, with the
examples written beside the code run as tests too.

## Declaring

A test module (`*_test.ts`) declares its tests with `test`, or a `suite` of
clauses sharing a name and tags, and says what it expects with `equal` (deep
equality), `ok` (truthy), `match` (a partial pattern) and `throws`. Each check
returns what it checked.

```ts ignore
import { equal, match, suite, test, throws } from '@yaks/testing'

test('two and two', () => equal(2 + 2, 4))
test('a slow one', async () => ok(await shop()), { tags: ['kernel'] })
test('not yet', () => {}, { skip: true })

suite('parse', ({ it, equal }) => {
  it('reads a word', () => equal(parse('a'), ['a']))
  it('refuses a quote', () => throws(() => parse('"'), 'unclosed'))
})
```

A module loaded by anything but the runner (`deno test`, an editor) hands each
test to `Deno.test`.

## Waiting

A test never sleeps a fixed span. It yields one macrotask with `tick`, and waits
on a fact with `until`, which polls until the fact holds and fails only when a
timeout passes, so a loaded machine makes a test slower, never red.

```ts
import { tick, until } from '@yaks/testing'

let ready = false
setTimeout(() => ready = true)
await tick()
await until(() => ready, { timeout: 2000, label: 'ready' })
```

`until` returns the fact's value, rethrows an error the fact throws, and names
`label` in its timeout (a thunk is read at the timeout, so it can say what the
state was then).

## Examples

An example written beside the code is a test, in either of two forms:

- a fenced `ts` block in a Markdown page, or in a doc comment in a module, where
  it uses the module's exports without importing them. A block marked
  `ts ignore` is not run.
- a doctest line in a module: `/// input -> output` checks equality,
  `/// input ~> pattern` awaits the input and matches it partially, and
  `/// input throws 'message'` expects an error. A line with no arrow
  (`/// let n = 1`) is a statement the module's doctests share, a line indented
  past its first continues it, and `// /` skips a line.

```ts ignore
/// twice(2) -> 4
/// parse('a b') ~> { words: ['a'] }
/// parse('"') throws 'unclosed'
export let twice = (n: number) => n * 2
```

Each example is compiled to a module written beside its page, so its imports
resolve exactly as the page's do, and removed once loaded; its code keeps the
page's line numbers.

## Running

```sh
deno run -A packages/testing/main.ts [--tag=t]... [--platform=p] [--all] \
  [--also=path]... [--timeout=ms] path...
```

A path is a test module, a page, or a directory holding them. Every file loads
into this one runtime, one at a time, and its tests run as it loads: its header
says what loading it took (`running 9 tests from ./a_test.ts (loaded in 12ms)`),
and each test how it went (`name ... ok (12ms)`). A module that cannot load
fails as a test of its own, and a test that has not ended within `--timeout` (50
seconds) fails while the run goes on. The exit code is 1 when a test failed.

`--tag` keeps the tests carrying every tag named; `--platform` is a tag every
test in the runtime carries.

A file whose tests all passed is left out while nothing it depends on has
changed. What it depends on is its module graph as `deno info` resolves it,
every file a module in that graph names beside itself
(`new URL('./fixture.json', import.meta.url)`), the runner, the config and lock,
the Deno version, and whatever `--also` names. A directory named is a place (a
root, a working directory), not what lies in it. The record of passes is
`~/.cache/yak/tests-passed.json`, shared by every checkout on the machine. A
file read any other way is not seen; `--all` runs everything, and a run picked
by tag records nothing.

In this repository `deno task test` (bin/test.ts) starts one runtime of the
runner per platform: deno, browser, terminal and workerd.

## Compatibility

Declaring, checking and waiting work in any runtime with `setTimeout`. The
runner needs Deno, whose `deno info` it reads; it removes an example a killed
run left behind by that run's process id, which it reads from `/proc`.
