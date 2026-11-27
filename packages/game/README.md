# @yaks/game

Game rules, a full-viewport screen, browser controls and HUD parts. The root and
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

## Exploration starter

On yaks.app, pass `starter: {}` to `app_files` for the 3D starter. Set
`view: 'voxel'` for a voxel scene, `view: '2d'` for a board, or multiplayer:
true`to add rooms to any view. Set`starter.into`to place the
starter in a new sandbox folder. Edit the files there and stage them with`sandbox_ship`. Without`into`,
the starter goes into the app's draft.

The [starter](./starter/) is a complete yaks app. Copy its files to an app draft
and deploy with the normal compiler. Open the app root for the low-poly world or
`voxel.html` for the voxel world. Both use the same controls, lit scene and
player-following camera. The compiler shares Three.js between the page and the
toolkit.

Supply the world and player meshes to `play`. The app decides how input changes
the player's pose, and `look` draws from that pose. The voxel entry uses
`@yaks/voxel/three` to build meshes from the app's boxes. Keep that entry and
dependency when building a voxel world.

## Page graph

`page` from `@yaks/game/page` loads the app's `./api/vocab.json` and composes
the page-only `Controls` component and any vocabulary passed as `words`. It
returns the `@yaks/client` client. Use `ent(eid)` for indexed reads and
`watch(query, { remote: false })` for a compiled local watch. Apply one bundle
batch per simulation step with `mutate`. Components declared as `sync: none`
stay in RAM. Stored components go through the app store.

The exploration starter passes input and the current pose to its movement rule,
then draws from a local watch on `PlayerPose{x, y, z, yaw}`. A turn-based game
can use the same client to apply a batch on each action.

## Live rooms

The starter's `room.html` can host, join and reconnect to an invitation-only
room. Deploy the app with private access and share the link from **Copy
invite**. The app worker binds the browser to its seat, opens only that room's
watch and exposes only the components needed to play. Keep the browser's
invitation in the link fragment and its digest in the store.

`room-client.ts` opens the room-scoped page graph. `room-wire.ts` carries the
subscription and peer motion through the store's socket. The app's
`room-rules.ts` checks turn order and returns the batch the worker saves. Moving
the pointer on the field shares a transient aim marker. Tapping a tile up to
three steps away walks the pawn there; tapping a foe beside it strikes, and
tapping a knocked-out ally beside it revives them. A strike rolls a d6 against
the foe's guard and `blow` sets the damage. Each hit is a `play_hit` row, and
`hpOf` sums a target's hits on its current life, so health is never stored and a
revive is a new life. When the last standing player ends a turn, every foe walks
toward the nearest player and strikes back. The store pushes the new turn,
positions and hits to each page, whose `Party` panel shows every player's and
foe's health.

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

## Game screen

`@yaks/game/screen` supplies the edge-to-edge viewport for both canvas and SVG
games. Call `screenStyle(document)` and give the body `GameScreen`, the canvas
or SVG `GameScreen_Surface`, and the overlay `GameScreen_Hud`. Use
`viewport-fit=cover` in the viewport meta tag. The HUD pads to the device's safe
areas, with `--game-gutter` as its minimum inset. Give an interactive HUD
element `GameScreen_Control` so it can receive pointer events.

`fullscreenButton(button, refused)` wires a native button, follows browser
fullscreen changes, and returns a function that removes its listeners. For a
custom control, use `fullscreen(document, refused, changed)` and draw from the
returned `on` and `busy` values. Give an installable game a web app manifest
with `"display": "fullscreen"` to launch in that mode where supported.

`fitting(boxes, fit)` runs `fit` in the next frame whenever one of `boxes`
resizes, the window resizes or fullscreen changes, and once at the start, and
returns a function that stops it. Observe the layout boxes the surface is fitted
to, and size the canvas or set the SVG's `viewBox` in `fit`: a fit run inside a
`ResizeObserver` callback that changes an observed box makes the browser raise
"ResizeObserver loop completed with undelivered notifications".

## Browser controls

`@yaks/game/controls` owns keyboard movement, two-button mouse walking,
pointer-lock and captured drag looking, a left-hand touch stick, right-hand
taps, wheel zoom and browser gamepads. It names no game actions: `keys`, `tap`
and `gamepad.buttons` map physical inputs to strings the consumer owns. Movement
key vectors, turn keys and rates are values too. `read(dt)` returns one
normalized movement, turn, look delta, held actions and edge-triggered actions
for every input device. Gamepad axes have a radial dead zone; missing,
disconnected or browser-denied pads supply no input.

`listen(stage, glass, busy, options)` installs browser resources. Options
include `get()` returning `{entity: {eid}, Controls}` and `onChange(bundle)`
applying its next value. The consumer names that entity, composes `docs` from
`@yaks/game/vocab` into its page vocabulary, and supplies its graph's read/write
doors. Every gesture, held key, pending action and preference belongs to that
single page-only `Controls` component. A remount with the same entity reads
those values; the package holds no graph. `busy()` gives keys and gamepads to
another control while typing. Screen buttons use `press(action)`. Call
`dispose()` to remove listeners, release pointer lock, cancel gestures and
unmount the stick. `cursor(x, y, locked)` belongs to the consumer's screen
projection. Accepted primary mouse, touch and pen taps return that press
position as `pick`; the app projects it onto its world. There is no world
picking in the package.

`touchStick` defaults to `true`: touches in the left 45% of the stage move the
touch stick, while touches elsewhere tap or drag to look. A point-and-build game
passes `touchStick: false` so taps and look drags work across the whole stage.
For example, the browser attachment for a game that has no movement stick is:

```ts ignore
// `stage`, `glass`, and `state` are the page's elements and controlled bundle doors.
import { listen } from '@yaks/game/controls'

let hands = listen(stage, glass, () => false, {
  ...state,
  axes: {},
  turns: {},
  keys: {},
  tap: { 0: 'select' },
  touchStick: false,
  cursor: (x, y) => [x, y],
})
// Read hands.read().pick to project a tap, and dispose when the page unmounts.
```

The root and `/rules` never import the browser controls or HUD. A worker can
continue to use the rules with no DOM, Preact or UI dependency.

## HUD kit

`@yaks/game/hud` exports `Grid`, `Party`, `Stats` and `Stick`, plus their `kit`
of CSS, terminal sheets and specimens. `Party` lists a party or its foes a line
each: name, a health bar and health, marking whose turn it is, low health and
the knocked out. `@yaks/game/ui` contributes that kit to the style guide. These
are paint only: the consumer supplies inventory cells, character values and
stick position, and owns all action handlers. Grid's cells include game
equipment/rarity marks, while Stats gives combat quantities their reading order.
General meters, key faces and panels belong to the general kits, not here. A
terminal hides the decorative touch stick, keeping the same Grid and Stats tree
readable through their sheets.
