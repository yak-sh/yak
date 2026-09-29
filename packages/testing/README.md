# @yaks/testing

What a test needs beside the code it tests.

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

## Compatibility

Any runtime with `setTimeout`: Deno, browsers, Workers and Node.
