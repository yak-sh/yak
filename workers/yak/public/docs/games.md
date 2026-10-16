---
doc:
  title: Build a multiplayer game
guide:
  slug: games
  brief: games with rules, controls, a HUD and a replaceable look
  description: >-
    Build on Holdfast's working multiplayer pattern: platform dependencies and
    their words, @yaks/game rules, controls and HUD, @yaks/stage presentation,
    @yaks/voxel geometry and its /three look, a shared clock, one page moving
    each creature, and recovering an order without charging twice.
---

# Build a multiplayer game

A game is a yaks app whose page reads the graph, decides what happens next, and
writes bundles back to the graph. The toolkit computes and draws values; it does
not own your graph, world, economy or save rules. Keep those in the app, so
another page can read the same play and a different look can draw it.

Start with the working examples:

- [Holdfast](https://yourname.yaks.app/holdfast/) is cooperative tower defense.
  Its app source is `apps/holdfast`: `rules.ts` decides play, `main.ts` connects
  the graph and browser, `ui.ts` draws the interface, and `look.ts` draws and
  picks the battlefield.
- [Mossvale](https://yourname.yaks.app/vale/) is a shared voxel adventure. Its
  app source is `apps/vale`. Its heroes, creatures, world and saved progress
  belong to that app, not to the toolkit.

Back to the map: <https://yaks.app/docs.md>. First read
<https://yaks.app/docs/storage.md> for `sync`, `durable`, `pace` and `save`:
which values other players see, which survive a disconnect, and which the store
keeps. App files and compilation are in <https://yaks.app/docs/code.md>; the
page's graph API is in <https://yaks.app/docs/store.md>.

## Add the toolkit to the app

A **platform dependency** is a package supplied by the running yaks.app release,
named with `"platform"` instead of an npm version in `package.json`. Holdfast
declares:

```json
{
  "dependencies": {
    "@yaks/client": "platform",
    "@yaks/game": "platform",
    "@yaks/graph": "platform",
    "@yaks/query": "platform",
    "@yaks/stage": "platform",
    "@yaks/sync": "platform",
    "@yaks/ui": "platform",
    "@yaks/ux": "platform",
    "@yaks/vocab": "platform",
    "@yaks/voxel": "platform",
    "preact": "^10.29.1",
    "three": "^0.186.1"
  }
}
```

Write your page's module as TypeScript and load it with
`<script type="module" src="main.ts"></script>`. `app_deploy` compiles it; a
platform dependency is not installed from npm. Ordinary npm dependencies still
use versions and `package-lock.json`. Three.js is one shared module between the
page and toolkit, not a second engine instance inside each package. Import
toolkit subpaths from their package, such as `@yaks/game/controls` or
`@yaks/voxel/three`; declare the package root in `dependencies`.

Dependencies also bring their **vocabulary**, the components and properties a
graph understands. The store composes a dependency's stored and relayed
components with the platform's and your `vocab.json`. Don't copy those
components into `vocab.json`: a duplicate declaration refuses the deploy. A
dependency adds no rules, tools or effects to the store just by being named.
Removing a dependency does not erase rows already stored under its words. The
complete composition and removal rules are in <https://yaks.app/docs/code.md>.

`@yaks/game` supplies the page-only `Controls` component; the pure rules,
`@yaks/stage` and `@yaks/voxel` add no stored game words. `Controls` has
`sync: none`, so it does not enter the store's vocabulary. Compose the `docs`
export from `@yaks/game/vocab` into the **page** vocabulary before using
controls. Holdfast also composes `@yaks/ux/vocab` for page-only interface
choices. Its `main.ts` adds only definitions absent from the fetched
`./api/vocab.json`, rather than declaring server words twice.

## Keep play in the graph

Holdfast separates three kinds of component:

| Kind                               | Holdfast components                                                                             | Declaration                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Authored designs and kept play     | `map_design`, `wave_design`, `enemy_design`, `tower_design`, `run`, `tower`, `spent`, `cleared` | Defaults: `sync: server`, `durable: forever` |
| Live battle                        | `conductor`, `creep`, `shot`, `firing`                                                          | `sync: peers`, `durable: 5s`                 |
| Presence and orders                | `defender`, `command`, `reply`                                                                  | `sync: peers`, `durable: connection`         |
| This page's choices and scheduling | `Build`, `Simulation`, `Presentation`, `Controls`                                               | `sync: none`, `durable: connection`          |

A **run** is one shared defense of one map. Its link carries the run entity's id
in `?run=…`. Pages subscribe to that entity and the rows referring to it. The
link selects the run; it grants no permission. In Holdfast an editor can build
and send waves, while a public reader watches. Invite players through
<https://yaks.app/docs/sharing.md>.

Gold is the map's starting gold plus cleared-wave bounty minus `spent.gold`.
Lives are starting lives minus recorded and current leaks. Don't store a second
balance that can disagree with those rows. A build writes the tower and its
spending receipt together; a sale deletes the tower and records a negative
spend. The store's atomic batch and compare-and-set guard protect racing writes,
not the animation loop.

## Compute rules, then write their result

`@yaks/game` and `@yaks/game/rules` export the same pure rules API. They need no
DOM, graph or renderer. Use path following (`along`, `advance`, `aStar`),
targeting (`aimOf`, `takenBy`), combat (`through`, `blow`), scheduled hits
(`shotFlight`, `arrivals`), ownership (`ownerOf`) and bounded stepping
(`fixedStep`) where they fit your rules. You supply designs and eligible values;
the package does not fetch them.

Holdfast's `rules.ts` reads snapshots supplied by `main.ts`. Its `build`,
`upgrade`, `sell` and `startWave` return bundles. Its
`step(rows, runId, now,
dt)` advances play and returns a batch. Each simulation
step applies its batch before reading the next snapshot. A shot decides its hit
when released and carries a shared-clock `lands` deadline; the owner applies it
when due.

### One page moves each creature

The **owner rule** chooses the lexically first eligible page id. `ownerOf`
accepts `[id, {x, z, awake}]` values, an entity's home and a horizontal radius;
it returns that id or `''` if nobody qualifies. Every page uses the same rule
and only the chosen page advances that entity. Other pages draw relayed values,
optionally predicting between updates with `follow`.

This runnable rules example shows both election and a 20 Hz step plan:

```ts
import { fixedStep, ownerOf } from '@yaks/game'
import { equal } from '@yaks/testing'

let pages = [
  ['page-b', { x: 0, z: 0, awake: true }],
  ['page-a', { x: 1, z: 0, awake: true }],
] as const
let home = { x: 0, z: 0 }
equal(ownerOf(pages, home, 5), 'page-a')
equal(ownerOf(pages.slice(0, 1), home, 5), 'page-b')
let plan = fixedStep(120, 0, 20, 5)
equal(plan.steps, 2)
equal(plan.remainder, 20)
```

Mossvale elects among awake players near each creature's home. Holdfast elects
one **conductor**, the page advancing the entire run, including every creep and
shot. It uses `defender` heartbeats less than 3500 ms old, places all those
candidates at the same election point, and compares the returned id to this
page's defender id. Defender ids are per page, not a signed-in person's id.

Holdfast gives live battle components a five-second lifetime and refreshes the
active simulation as it advances. When its conductor disappears, another awake
defender can take over the last relayed wave before those values expire. If
everyone leaves, live battle values expire; stored towers and cleared waves
remain, and that wave can start again. A reload is not a durable save of every
creep.

Election is cooperation between pages, not a server lease or an anti-cheat
boundary. Pages can briefly disagree about presence. Keep durable spending
protected by store guards even when you expect only one conductor.

### Use the right clock

`@yaks/sync` supplies the **shared clock**, an estimate of epoch milliseconds on
the store's clock, through `front.wire.now()` on a server-connected
`@yaks/client` client. Holdfast uses it for heartbeats, wave starts and hit
deadlines. Do not compare a timestamp from another player's wall clock with
`Date.now()` on your page.

Use `performance.now()` for local elapsed animation time. Pass elapsed
milliseconds and the previous remainder to `fixedStep`; keep the returned
remainder in `Simulation`. At 20 Hz, a step is 50 ms and the rule's `dt` is
`0.05` seconds. Bound catch-up steps after a suspended page instead of running
an unlimited backlog. Holdfast allows five steps per frame and draws at 30 Hz.

The shared clock calibrates over the existing socket. Before its first reply it
uses the local epoch; while disconnected it keeps the last offset and calibrates
again on reconnect. Corrections can move either way. It is neither a
subscription-readiness signal nor a security authority; wait for the run's
subscriptions to be ready separately.

## Controls and the HUD are controlled by the page

`@yaks/game/controls` maps keyboard, pointer, touch and gamepad input to actions
you name. **`Controls`** is the page-only component holding keys, gestures,
pending actions and preferences on an entity the app chooses. `listen` gets that
bundle through `get` and writes its replacement through `onChange`.

This browser attachment assumes the page has composed `@yaks/game/vocab`, opened
`front`, chosen `controlsId`, and mounted `canvas`; it cannot run without those
browser resources:

```ts ignore
import { listen } from '@yaks/game/controls'

let hands = listen(
  canvas,
  canvas,
  () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? ''),
  {
    touchStick: false,
    axes: {},
    turns: {},
    keys: { Enter: 'build', Space: 'wave' },
    tap: { 0: 'select' },
    gamepad: { buttons: { 0: 'build', 3: 'wave' } },
    cursor: (x, y) => [x, y],
    get: () => front.ent(controlsId) ?? { entity: { eid: controlsId } },
    onChange: (bundle) => {
      void front.mutate([bundle])
    },
  },
)
// In the frame: hands.read(dt) gives actions, orbit, zoom and pick.
// On unmount: hands.dispose().
```

`touchStick: false` lets a point-and-build game use the whole battlefield for
taps and orbit drags. A walking game can use the default left-hand stick.
Project `read(dt).pick` through the look's picking function; controls know no
world coordinates. Visible buttons should call the same app actions as keys and
gamepads, so the canvas is not the only way to play.

`@yaks/game/hud` supplies paint-only `Grid`, `Stats` and `Stick`, plus their
`kit` of CSS and terminal sheets. Holdfast's `ui.ts` renders `Stats` from the
run's derived gold, lives and wave values; its `main.ts` links the stylesheet
URLs from `kit`. It uses general buttons and panels from `@yaks/ui` and
controlled disclosure from `@yaks/ux`. The HUD never charges gold, owns a
selected tower or runs the simulation. Read values from the graph and send
actions back through the app.

For example, this browser view receives `gold` from the run snapshot and mounts
into the page's `root`; it does not keep a separate balance:

```ts ignore
import { h, render } from 'preact'
import { kit, Stats } from '@yaks/game/hud'

let css = document.createElement('link')
css.rel = 'stylesheet'
css.href = String(kit.Stats.css)
document.head.append(css)
render(
  h(
    Stats,
    { 'aria-label': 'Run resources' },
    h(Stats.Stat, {}, h(Stats.Words, {}, `${gold} gold`)),
  ),
  root,
)
```

## Keep the look replaceable

`@yaks/stage` supplies Three.js presentation: `/render` for a renderer and frame
scheduling, `/cam` for camera intent, `/aim` for picking, and `/ears`, `/sound`,
`/samples` and `/bus` for positional sound and volume. It knows no voxels or
graph. You supply geometry, collision callbacks, clip URLs and camera values.

`@yaks/voxel` turns grids and boxes into packed quads. Its root and geometry
subpaths are safe in a worker. **`@yaks/voxel/three`** is the voxel look:
`geometry` adapts packed quads to Three.js, `soft` supplies voxel material,
box-part helpers assemble rigs, and `puppet` animates a supplied rig. Those
rendering imports belong in the page, not a worker mesher.

Holdfast's `look.ts` imports `renderer` from `@yaks/stage/render`, `geometry`,
`soft` and `puppet` from `@yaks/voxel/three`, and ordinary Three.js from
`three`. `createLook(canvas)` returns `draw`, `pick`, `sound` and `dispose`.
`main.ts` hands `draw` a graph snapshot, run id, selected site, shared time and
camera values. The look owns GPU and audio handles, not a second copy of play.
Replacing it should leave `rules.ts`, spending receipts and saved runs
unchanged. Dispose its resources and the controls when the page leaves.

This browser-side boundary can draw ordinary geometry without any voxel imports.
It needs a mounted `canvas`; the caller owns the loop and disposal:

```ts ignore
import * as THREE from 'three'
import { renderer } from '@yaks/stage/render'

let gpu = renderer(canvas, 640, 360, 1)
let scene = new THREE.Scene()
let camera = new THREE.PerspectiveCamera(40, 640 / 360, 0.1, 150)
camera.position.z = 4
let shape = new THREE.BoxGeometry(1, 1, 1)
let material = new THREE.MeshBasicMaterial({ color: 0x80cbd0 })
scene.add(new THREE.Mesh(shape, material))
gpu.render(scene, camera)
// On unmount: shape.dispose(); material.dispose(); gpu.dispose().
```

For a voxel look, replace the geometry and material construction with
`geometry(packedQuads)` and `soft(...)` from `@yaks/voxel/three`. Keep the
`packedQuads` generation in the app or a worker using `@yaks/voxel`; stage still
receives ordinary Three.js geometry.

## Recover a dropped order without charging twice

There are two different losses to handle:

1. **A peer order loses its socket.** Sync reconnects and resends values it
   still owns. Keep the command's original entity id. Holdfast puts `reply` on
   that same row; an already answered command is cleared, not executed again.
   Don't create another command just because the connection dropped.
2. **A stored transaction loses its answer.** The store may already have
   committed it. `WriteUnknown` from `@yaks/client` is an unknown outcome, not
   permission to plan and charge again. `WriteRefused` is a deliberate refusal,
   not the same condition.

Holdfast's `recovery.ts` retains the exact decided batch, its compare-and-set
preconditions, an immutable `spent`, `cleared` or `run` receipt, and one write
key. It sends with `front.mutate(batch, { optimistic: false, key })`. Every
retry uses that same batch and key; it never allocates another purchase receipt
or plans against an optimistic purse.

After an unknown outcome it reads **authoritative server rows** for every
affected id, bypassing the local replica. Matching all expected immutable
receipts proves the atomic transaction landed. Recovery then restores the
accepted server rows and deletions to the replica and applies the held peer
companions, including the command's reply. A mutable tower value alone is not
proof.

If the authoritative read succeeds and the receipt is absent, recovery sends the
original transaction again. If the read fails, it waits and reads again; that
failure proves nothing about acceptance. If a retry refuses after an unknown
outcome, it checks the receipt again before treating the refusal as final. An
unknown durable write with no immutable receipt is an error, not a safe blind
replay.

Keep unexpected failures reported and let subsequent frames continue from the
graph. Don't turn a recoverable network interruption into instructions to
reload. This is recovery while the page holds the batch, not a durable offline
order queue that survives closing the page.

## Check the game with two pages

Open one Holdfast run link in two pages with editor access. Build from each;
both should show the same towers and purse. Send a wave, then close the elected
page: the other should continue the live wave. Leave every page long enough for
its live values to expire, reopen, and check that towers and completed waves
remain while the unfinished wave can restart.

Test a lost stored-write response separately from an ordinary socket reconnect:
the accepted receipt must finish the original order, without a second spend.
Holdfast's `rules_test.ts` and `recovery_test.ts` cover the rules and recovery
decisions without a renderer. Check public readers too: a run link must not turn
a watcher into a builder.
