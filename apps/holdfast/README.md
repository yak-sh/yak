# Holdfast

A cooperative 3D tower defense at `yourname.yaks.app/holdfast/`. Build beside
other players, share one purse, and hold twelve waves on The Orchard, Riverbend
or The Switchback. This app is kept in Git and deployed to the `yourname` space;
it is not a published gallery offering.

A **run** is one defense of one map. Its link carries the run's entity id in
`?run=…`. Everyone opening that link reads the same towers, purchases, completed
waves and live battle. App sharing controls who may play: an editor can build
and send waves; a reader watches.

## Play together

1. Choose a map and press **Raise the banner**.
2. Pick a pale building site in the battlefield, or choose a numbered site in
   **Build sites & field guide**.
3. Choose a tower blueprint and press **Build**. A selected tower offers
   **Upgrade** and **Sell tower**; a sale refunds 70% of its tier investment.
4. Press **Send wave** when the team is ready. The next wave waits for another
   press, leaving time to build together. A cleared wave adds its bounty to the
   shared purse. Each enemy reaching the gate costs one life.
5. Press **Invite a friend** to copy the run link. Give the friend editor access
   through the app's sharing, then send that link.

An app-specific invitation uses the platform's `member_add` command, rather than
opening the whole space:

```text
member_add(email: "friend@example.com", app: "holdfast",
           role: "editor", space: "yourname")
```

The friend accepts the invitation and opens the run link. Copying a link alone
does not grant permission. A public visitor can watch but cannot spend the
team's gold. See [app sharing](../../workers/yak/public/docs/sharing.md).

The four tower families have three tiers each:

| Tower       | Role                                                     |
| ----------- | -------------------------------------------------------- |
| Ranger      | Fast, precise shots for runners.                         |
| Bombard     | Splash damage against packed groups.                     |
| Winterglass | Slowing shots that buy the other towers time.            |
| Starwell    | Armour-piercing shots against Ironbacks and Stonehearts. |

Hares run quickly, Brambles arrive in groups, Ironbacks carry heavy armour and
Stonehearts take sustained fire. Enemy health and group sizes increase across
the twelve authored waves. The fort wins after the last wave; zero lives ends
the run in defeat.

### Controls

Mouse and touch both select building sites with a tap or click. Drag to orbit
the camera; a mouse wheel changes zoom. The touch movement stick is disabled
because this game uses pointing rather than a walking character.

Keyboard keys `1`–`4` choose tower families, `Enter` builds and `Space` sends a
wave. Gamepad buttons 0 and 3 build and send a wave; buttons 4 and 5 move
between building sites. The visible buttons and numbered site list provide the
same choices without the canvas.

## The graph owns the game

`package.json` declares the toolkit dependencies as `"platform"`. The app's
store composes their stored and relayed vocabulary with `vocab.json`.

`main.ts` opens one `@yaks/client` graph, watches the authored designs and the
chosen run, reads snapshots, and applies bundles. No game or interface choice is
kept in browser storage. Renderer meshes and audio handles are presentation
resources; the graph remains the source of play and camera choices.

### Authored designs

`seed.json` installs the authored designs once per store; `seed.ts` is the typed
source and a fill-missing fallback for existing stores. Existing rows are read
from the store rather than replaced during play:

- `map_design{name, path, slots, gold, lives}` describes a route, build sites,
  starting purse and gate lives.
- `wave_design{map, n, groups}` describes ordered enemy groups and their gaps.
- `enemy_design{name, hp, speed, armour, bounty, figure}` describes an enemy.
- `tower_design{name, cost, range, rate, damage, splash, slow, speed, pierce,
  upgrade, figure}`
  describes one tier. `upgrade` points to the next tier; `figure` is
  presentation data.

### Stored play

- `run{map, seed}` identifies a shared defense. The platform's `completed{}`
  marks its end; the remaining lives distinguish victory from defeat.
- `tower{run, design, slot, policy}` places a tower. An upgrade changes
  `design`; a sale deletes the tower.
- `spent{run, gold, tower}` records a purchase or sale. Sale amounts are
  negative. Each purchase ordinal has one deterministic entity id and a
  compare-and-set precondition, so racing coordinators cannot both spend that
  ordinal.
- `cleared{run, wave, leaked, bounty}` records the wave's result.

Gold is the map's starting gold plus cleared bounty minus spending. Lives are
the map's starting lives minus recorded leaks and the current wave's leaks.
Neither total is a second stored balance.

### Relayed play

`defender{run, slot, at}` is connection-lifetime presence: a page playing the
run, its pointed site and its heartbeat. Other pages draw that site as a
coloured ring.

The lexically first recently awake defender is elected with `@yaks/game`'s
`ownerOf`. That page advances the run; the others render the relayed values:

- `conductor{run, wave, started, spawned, leaked, bounty, at}` tracks the active
  wave.
- `creep{run, design, wave, along, hp, at, slow_until, slow}` tracks an enemy's
  distance along the route and combat values.
- `shot{run, tower, creep, lands, damage, splash, slow, pierce}` records a hit
  decided at release and applied at its shared-clock landing time.
- `firing{run, at}` records the tower's last shot time.

These simulation components use `sync: peers` and a five-second lifetime. The
elected page refreshes them while advancing the wave, allowing another awake
page to take over after a disconnect. With no page advancing the run, the live
wave expires; its stored towers and completed-wave ledger remain, and that wave
can be started again.

`command{run, defender, action, slot, design, at}` relays an order to the
elected page. It processes orders serially against fresh graph snapshots and
returns `reply{run, defender, message, at}`. Both are connection-lifetime peer
values. The server relays the battle; it does not run a real-time simulation
loop.

### Page-only choices

`Build{run, slot, design, map, message, pending}` holds the page's choices,
feedback and an order in progress.
`Simulation{then, remainder, busy, pulse, paint, uncertain}` holds scheduling
values; `Presentation{view, frame}` holds the orbit and draw timestamp. These
components declare `sync: none`. `Controls{…}` comes from `@yaks/game`, and
`Disclosure{open}` comes from `@yaks/ux`; both are controlled through the same
page graph.

## Modules and package boundaries

- `rules.ts` is pure: `view(rows, runId)` derives the visible run; `build`,
  `upgrade`, `sell` and `startWave` return bundles; `step(rows, runId, now, dt)`
  advances play. `now` uses shared-clock milliseconds and `dt` uses seconds.
- `main.ts` owns browser resources, subscriptions and orchestration. Simulation
  uses `fixedStep` at 20 Hz and the socket's shared clock from `@yaks/sync`.
- `ui.ts` renders graph values with Preact, `@yaks/ui`, `@yaks/game/hud` and the
  controlled `@yaks/ux` Disclosure. `style.css` owns this app's layout.
- `look.ts` is the replaceable visual boundary. `createLook(canvas)` returns
  `draw`, `pick`, `sound` and `dispose`. It uses `@yaks/stage` for rendering,
  camera, picking and positional sound, and `@yaks/voxel/three` for voxel rigs,
  packed geometry and materials. Replacing this module does not change the
  economy, targeting, waves or stored play.

Path following, timed hits, splash targeting, armour calculations, ownership and
fixed-rate planning come from `@yaks/game`. Platform or toolkit defects belong
in their owning packages, not in app-local substitutes.

## Check and deploy

From the repository root:

```sh
deno check apps/holdfast/*.ts
deno lint --config deno.json apps/holdfast
deno task test:budget apps/holdfast
```

The pure rules tests cover the shared purse, occupied sites, upgrades and sale
refunds, wave progress, scheduled hits, slowing, splash, victory and defeat.
Browser verification additionally needs two pages of one run: build from each,
check the same purse and pointed sites, watch the same wave, and close the
elected page to verify handoff.

Land changes with `yak land`. Deploy only from a clean main checkout whose
`HEAD` equals `origin/main`:

```sh
yak admin push apps/holdfast --space yourname --as admin
yak --host yaks.app app_errors --space yourname --app holdfast --as admin
```

This releases the app without publishing a gallery offering. Git remains its
source; do not edit its live files outside the repository. See
[the apps directory](../README.md).
