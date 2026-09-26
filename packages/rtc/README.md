# @yaks/rtc

Voice between pages over
[Cloudflare Realtime](https://developers.cloudflare.com/realtime/): a page joins
a call, publishes its microphone, and hears the tracks it asks for. The bytes go
through Realtime's SFU and never touch the graph. What a page says is named on
the entity it speaks as, in the relayed `rtc` component, so a listener finds a
voice where it finds everything else about that entity.

There are no rooms. A page hears the voices it asks for, and a voice goes quiet
for everyone when its tab closes, because the relay clears `rtc` with the
connection that wrote it ([@yaks/sync](../sync)).

## A page

```ts ignore
import { join, microphone } from '@yaks/rtc'

let call = await join({ entity: hero, write: (b) => client.mutate(b) })
let voice = await call.publish(await microphone())
call.mute(true)

// a peer wearing rtc{session, tracks: ['voice']}
let heard = await call.hear(peer.rtc.session, 'voice')
audio.createMediaStreamSource(heard!.stream).connect(panner)
await heard!.stop()
await voice.stop()
await call.leave()
```

- `join({entity, write, door?, change?})` opens a session through the app's door
  (`./api/rtc/` beside the page) and wears `rtc` on the entity: its session, the
  tracks it publishes, and whether it is muted or talking. `change` hears the
  call's state: `live`, `limit` (the space's allowance is used up, and voices go
  quiet until it lifts), `refused`, `lost` while it reconnects, `left`.
- `publish(track, name = 'voice')` sends a track, capped at 32 kbit/s, and names
  it in `rtc.tracks`. `talking` follows the microphone's level, read off the
  sender's own statistics.
- `hear(session, track)` subscribes to another session's track and returns its
  stream, or null for a track that is gone. The stream already plays through a
  muted `<audio>`: Chrome plays a remote track that feeds only Web Audio as
  silence.
- The call renews its lease about every 30 seconds and re-writes `rtc` with it.
  A failed connection, or a lease the door no longer holds, is a new session: it
  publishes again, and every `Heard` it had goes `live: false`, for the page to
  ask again.

Chrome's echo canceller does not hear what Web Audio plays, so a voice played
through a `PannerNode` to the speakers can reach the microphone and return to
its speaker. Media elements are cancelled, including a Web Audio mix sent
through a local peer connection into an `<audio>`. Headphones sidestep it.

## A host

`@yaks/rtc/door` answers Realtime's own paths and bodies for one app
(`sessions/new`, `sessions/<id>/tracks/new`, `renegotiate`, `tracks/close`,
`tracks/update`, `datachannels/new`, `datachannels/close`, and a `GET` of a
session), so Cloudflare's pages apply word for word, plus `ice` (TURN's ICE
servers) and `sessions/<id>/renew`. The host hands `answer` each call with
everything it knows about the caller's world:

```ts ignore
import { answer, lapse } from '@yaks/rtc/door'

let res = await answer({
  req,
  path, // within the door: '/sessions/new'
  store, // the app's store: read(query), write(bundles)
  meter, // refused() -> sentence | null, spend(dollars)
  realtime: { app, token, turn: { key, token } },
  rates: { track, channel }, // dollars a second received
})
```

- Every session the door opens is an `sfu{session, key}` row in the store, with
  a `wake` when its lease ends a minute out. A session a call names, the
  caller's own or one it subscribes to, must be one of them, so one app never
  reaches another's sessions.
- A change to a session carries the key `sessions/new` handed back
  (`x-yak-rtc-key`); the row keeps its SHA-256. The session id is no proof:
  `rtc` relays it to every listener.
- The allowance is asked before a session opens, before it subscribes to
  another, and before each renewal. A renewal weighs the time it extends the
  lease by: Realtime's reading of the session, each active remote track and
  channel at its rate. Realtime reports no bytes per session, so this is an
  estimate.
- When a lease lapses, its wake fires, and the host runs `lapse`: it closes the
  session's open tracks at Realtime and drops the row.
- A refusal is `{error: {code, message}}`: `limit` (429), `not_found` (404),
  `not_yours` (403), `unavailable` (502, reported through `report`).

## The components

`@yaks/rtc/vocab` declares `rtc` (relayed, gone with its connection, sent at
most every 200 ms) and `sfu` (`wire: false`: only the door writes it).
