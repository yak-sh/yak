---
name: storage
description: "What players see, and what is kept (yaks.app). Choose which component values stay in one page, reach the store, or are relayed to other pages. Learn sync, durable, pace and save through Mossvale's saved positions and Holdfast's timed creatures, including disconnects, local drafts and the difference between relay and storage."
---

# What players see, and what is kept

A multiplayer app has values that belong in different places: a player's earned
items, their moving position, and the panel open on their screen. Choose for
each **component**, the named set of properties an entity carries, rather than
for the whole entity. A hero can have a stored `player` component and a relayed
`motion` component on the same entity.

Back to the map: <https://yaks.app/docs.md>. Declaring components and their
properties: <https://yaks.app/docs/components.md>. Reading and writing them from
a page: <https://yaks.app/docs/store.md>.

## Choose who hears a write: sync

**`sync`** says who is told about a component's writes. Declare it beside
`properties` in `vocab.json`:

| `sync`                 | What the writing page sees                           | What other pages see                       | What the store keeps                    |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `server` (the default) | Its local write, reconciled with the server's answer | Stored values through their subscriptions  | Accepted writes                         |
| `peers`                | Its local write immediately                          | Relayed values through their subscriptions | Nothing unless `save` admits a snapshot |
| `none`                 | Its own value                                        | Nothing from this write                    | Nothing                                 |

A **relay** forwards a value to subscribed pages without making an ordinary
stored write. It holds the latest value so a page joining later can receive it,
but this held value is not a durable record. A server restart can lose unsaved
relay values. Subscriptions select what a page receives; `peers` does not mean
every visitor receives every value, and it is not an access setting.

Use the same `apply` operation for all three. The client routes each component
according to its declaration; don't send a fetch on every animation frame.

## Choose how long it lives: durable

**`durable`** says how long a value lives, to the place responsible for keeping
it. It is independent of `sync`. Its default is `forever`.

- **`forever`** keeps stored state until it is changed or removed. For a local
  component (`sync: none`), the client saves it in this browser's IndexedDB when
  local persistence is enabled. It is not a backup in the app's store and does
  not follow the player to another browser.
- **`connection`** on a relayed component clears it when the relay detects that
  its writing connection has closed. Another connection can take it over by
  writing it; the old connection closing then does not clear the replacement.
- **A duration**, such as `5s`, on a relayed component clears it that long after
  its last relayed write. Each write restarts the timer. Closing the writing
  connection does not clear it early: another page has the remaining time to
  take over. Expiry sends a component removal to subscribers.

Durations use `ms`, `s`, `m`, `h` or `d`, for example `100ms`, `2m` or `0.5s`. A
lifetime is not a request to remove the entity: the other components remain. For
`sync: none`, only `forever` is persisted locally; other lifetimes stay in
memory. Don't use a local duration as a countdown timer, or `durable` on a
server component as a scheduled deletion. Those declarations do not schedule
store deletion.

### Keep the player's input

This complete `vocab.json` keeps an unsent message in the writing browser:

```json
{
  "$defs": {
    "unsent": {
      "component": true,
      "type": "object",
      "sync": "none",
      "durable": "forever",
      "properties": { "text": { "type": "string" } }
    }
  }
}
```

Write `unsent: { text: '…' }` on the entity you use for the form. A reload can
restore it from this browser; another player's page cannot read it from the
store. Don't give typed input a connection lifetime. Use `sync: server` when the
player needs it kept across browsers. Local persistence and its limits are in
the client reference's **Component storage** section:
<https://jsr.io/@yaks/client>.

## Choose how often it travels: pace

**`pace`** is the minimum interval at which a writer's value is taken. What
happens inside that interval depends on `sync`:

- With `peers`, the writing page still updates every frame. The client sends the
  first write immediately, folds subsequent patches into one, and sends the
  latest patch at the end of the interval. A removal goes immediately and
  cancels a waiting patch. Pace is per entity and component, not one limit for
  the whole page.
- With `server`, the store refuses a changed value written too soon. It does not
  fold writes or promise to send them later. The limit is per entity, component
  and vouched writing browser or client, even for an owner. An unchanged retry
  is not another write. See the refusal and writer identity details in
  <https://yaks.app/docs/components.md>.

Don't put `pace` on `sync: none`: nobody takes that value, and the declaration
is refused. A peer pace reduces traffic, not the number of local simulation
steps. It is not an anti-cheat rule or a server-side permission check.

## Save a relayed value without storing every movement

**`save`** is a query the entity's _stored state_ must match before the server
stores the latest admitted relayed value. It requires `sync: peers` and
`durable: forever`. Declare all three explicitly. `save` is a query, not a
duration and not a timer measured since the latest movement.

Mossvale uses this declaration for `position` on heroes and wildlife:

```json
{
  "$defs": {
    "position": {
      "component": true,
      "type": "object",
      "sync": "peers",
      "durable": "forever",
      "pace": "100ms",
      "save": ".player (!position.at | .position.at<=\"30s ago\")",
      "properties": {
        "level": { "type": "string", "index": true },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "z": { "type": "number" },
        "at": { "type": "number" }
      }
    }
  }
}
```

The app also declares and stores `player` on each hero. Its moving page writes
`position.at` in milliseconds along with the coordinates:

1. The writing player sees each local move. Other subscribed pages receive
   ordinary movement writes paced to one per `100ms` from that page. Removals
   bypass pacing, and reconnect can replay the current value.
2. A stored hero with no saved `position.at` matches immediately. A hero whose
   saved `position.at` is at least thirty seconds old also matches. The test is
   against the saved timestamp, **not** the incoming timestamp.
3. Until that condition holds, the server holds the latest admitted position,
   replacing it as movement arrives. It rechecks when the time condition can
   hold or a relevant stored change occurs. When eligible, it writes through the
   ordinary graph write boundary.
4. Wildlife has no stored `player`, so it never matches. Its positions are
   relayed but not saved by this query.

When the player disconnects, saving still checks the latest pending position. If
it must wait for the stored timestamp to age, it keeps that pending value for
the retry; disconnect does not force an ineligible save. That pending value is
held in server memory, not a durable queue. A reload restores the last _saved_
snapshot, not a promise of the final animation frame. Saved snapshots survive a
server restart; unsaved movement does not.

Use a timestamp belonging to this component for a component's save interval. An
unrelated write can change `updated.at`, so testing that instead may keep
postponing a position save.

## Let another page continue

Holdfast gives `conductor`, `creep`, `shot` and `firing` the declarations
`sync: peers` and `durable: 5s`, without `save`. These are live wave values, not
stored wave history. If the page moving them leaves, the relay keeps them until
five seconds after their last write. A replacement page can continue from them
and refresh their lifetime. Without a replacement they expire. Holdfast stores
the run and cleared waves separately with the defaults, `sync: server` and
`durable: forever`.

Mossvale's `motion` uses `sync: peers`, `durable: connection` and `pace: 100ms`:
other pages need the current direction and gait, but a returning hero does not
need yesterday's walking animation. Pick the lifetime for the recovery you
intend, rather than making every component permanent.
