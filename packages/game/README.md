# @yaks/game

Game rules over values, without a graph or a game world. The root and
`@yaks/game/rules` are the same pure API, safe in a browser or a worker. Each
game reads its graph, passes values, and writes the result in its own batch.

The first parts come from Mossvale. The move keeps the random sequences, named
entity ids, level curve and peer motion unchanged, so existing worlds and saved
progress keep their meaning. This package declares no stored words.

## Randomness, levels and motion

```ts
import { hashOf, need, stream, uuidOf } from '@yaks/game'
import { equal } from '@yaks/testing'

let random = stream(hashOf('my-run'))
equal(random(), stream(hashOf('my-run'))())
equal(need(1), 0)
equal(uuidOf('my-run/tower/1'), uuidOf('my-run/tower/1'))
```

`hash`, `rand`, `hashOf`, `uuidOf` and `stream` produce the same values on every
page. `noise` and `fbm` grow smooth fields; `smooth`, `lerp` and `clamp` blend
values. `need`, `maxHp` and `power` provide an optional level curve.

`follow(previous, motion, now, dt)` predicts a peer between packets and eases
corrections. Motion and `now` use milliseconds; `dt` uses seconds. The caller
keeps the returned `Remote` value. Prediction stops after 0.8 seconds without an
update; a teleport over 20 metres starts a new trail. No timers, subscriptions
or mutable game state are hidden in the package.

## In an app

Declare `"@yaks/game": "platform"` in package.json dependencies. The hosted
compiler supplies the current package. Mossvale is the first consumer; its
graph, vocabulary, world and decisions remain in apps/vale.

Run `deno task test packages/game` from the repository root.
