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

## Paths

`aStar` accepts nodes, stable keys, neighbours with costs, a goal and a
heuristic; it returns both endpoints or null. Keep a heuristic admissible for
shortest paths and supply a pop limit when the search must be bounded. `along`
samples a nonempty 3D path by distance. `advance` spends a horizontal movement
budget and returns the new position and remaining path, without mutating either
input.

`course` samples a 2D chord with a caller-supplied perpendicular offset.
`partCourse`, `nearCourse`, `clearOfCourse`, `alongCourse` and `offCourse`
operate on those samples. Road materials, noise policy, standing tests,
collision, and route caches belong to the game.

## Effects and combat

`Status<K, S>`, `Lasting<K, S>` and `Effect<K>` leave effect kinds and stat
names open. A game supplies amounts, modifier signs and which kinds are
periodic. `applied`, `elapsed`, `factor` and `refreshed` use absolute
millisecond deadlines; `carries` validates saved effects with the game's kind
predicate. `Area<E, C>` adds caller-defined cast context to arbitrary effect
values. `planted`, `within`, `pulse`, `following` and `received` place and
advance pulsing areas.

`blow` accepts critical-hit/spread rules, `through` accepts armour scaling and a
damage floor. `fallOf` collapses duplicate falls in a respawn window; `hpOf`
sums only damage to the requested target and life. The game owns the ledger and
supplies its rows; no graph is read here.

`aimOf` selects a target with hysteresis. `takenBy` covers one target, arcs,
rings and bursts. Both take target sizes from the caller. A game supplies its
weapon, attack shape and eligible targets; these helpers never load designs.

## Multiplayer and simulation

`shotFlight` computes flight duration and scattered visual shots from supplied
positions, speed and a random source. `arrivals` partitions scheduled hits into
due and pending values. Damage, impact eligibility and graph writes remain in
the game.

`ownerOf` elects the smallest eligible player id from supplied positions and an
awake flag. The game decides who is awake, nearby, or even eligible to own a
simulation. No connection or ownership state is hidden here.

`fixedStep(elapsed, remainder, hz, maxSteps)` plans bounded simulation steps
(default 20 Hz, at most five steps per frame). Time is in milliseconds. Keep its
returned remainder in the game's graph and draw using `alpha`. Whole steps
beyond the bound are reported as `dropped`; the caller chooses how to handle a
long suspension. Mossvale retains its existing frame-rate simulation; a new game
can use this planner without adopting Mossvale's world or vocabulary.
