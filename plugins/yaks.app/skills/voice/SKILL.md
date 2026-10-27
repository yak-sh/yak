---
name: voice
description: "Voice Calls (yaks.app). Voice calls (WebRTC audio) between the people in an app: a page joins a call through the app's ./api/rtc/ endpoint onto Cloudflare Realtime with @yaks/rtc, publishes the microphone, and receives the voices it requests. Who is speaking is the `rtc` component on the entity they speak as, relayed to every page watching it. Playing a voice through an audio element or as spatial audio with Web Audio, mute and talking state, who may join a call, and what an hour of listening costs against the space's monthly allowance."
---

# Voice Calls

The guide's index is at <https://yaks.app/docs.md>. This page covers all of
voice calls in an app: joining a call, sending the microphone, receiving other
people's voices, and the cost.

An app needs no API key and no server of its own for voice calls. Its pages
connect through the app's own endpoint, `./api/rtc/`, which the platform serves
through Cloudflare Realtime. The WebRTC client is a toolkit package the page
imports. Name it in the app's `package.json` with the version `"platform"`, and
the deploy compiles the page script with it ([Backend Code](./code.md)):

    {"dependencies": {"@yaks/rtc": "platform", "@yaks/client": "platform"}}

    import { join, microphone } from '@yaks/rtc'

## Joining a call and sending the microphone

A page joins a call as an entity: the entity the person is in the app, such as a
player or a seat at a table. `write` is the function the page writes that entity
with. It must relay the `rtc` component to the other pages instead of storing
it, which is what `@yaks/client`'s `mutate` does:

    let call = await join({ entity: me, write: (b) => store.mutate(b) })
    talk.onclick = async () => await call.publish(await microphone())

The browser asks the person for permission to use the microphone, so call
`publish` from a click or a key press. From then on, every page watching the
entity sees it carry `rtc { session, tracks: ['voice'], muted, talking }`, but
only while the tab is open: `rtc` is never stored, so it is removed when the
page closes.

- `call.mute(true)` stops sending audio without leaving the call, and sets
  `rtc.muted`.
- `rtc.talking` is true while the microphone picks up a voice, for a page that
  shows who is speaking.
- `call.leave()` ends the call and clears `rtc`.
- `join({ change })` calls `change` when the call's state changes: `live`,
  `lost` while it reconnects, `limit` when the allowance is spent, `refused`
  when this person may not speak here.

## Receiving and playing voices

A page receives only the voices it requests, so it requests only the ones it
needs: the people at the same table, or the players nearby.

    let voice = await call.hear(them.rtc.session, 'voice')
    let out = new Audio()
    out.srcObject = voice.stream
    await out.play()

`voice.stop()` stops receiving that voice. When a voice's speaker leaves, or its
connection is rebuilt, `voice.live` is `false`; request it again with the
speaker's new `rtc`.

For spatial audio, which places a voice at a position, connect the stream to Web
Audio instead:

    let source = audio.createMediaStreamSource(voice.stream)
    source.connect(panner).connect(audio.destination)

The stream `hear` returns is already playing through a muted `<audio>` element,
which Chrome requires before Web Audio receives any sound from it.

The browser's echo cancellation applies to what an `<audio>` element plays and
not to what Web Audio plays: in Chrome, a voice played through Web Audio on a
listener's loudspeakers echoes back to its speaker. Headphones prevent this.

## Who may join a call

Voice calls cost the space money, so by default only the app's members who may
change it can speak and listen. To let visitors join calls too, set `rtc` at the
top of the app's `vocab.json`:

    { "rtc": "open", "$defs": { … } }

Then anyone who may write to the app can join, which on an `open` app is anyone
with the link, at up to 60 requests to `./api/rtc/` a minute each.

## Cost and the monthly allowance

Voice is charged by listening time: about $0.001 for each voice a page receives
for an hour, and nothing for speaking. Ten people each hearing three others talk
for an hour costs about $0.03.

Voice spends the same monthly allowance as AI models: $0.20 a month on a free
space, shared by all the free spaces its owner has, and $3.00 on the Plus plan.
`app_list` reports how much of each space's allowance has been spent this month,
and how much of that was voice. When the allowance is spent, new calls and new
voice requests are refused (`limit`), the voices already being received stop
within a minute, and everything else in the app keeps working. Voice works again
on the 1st of the month, or as soon as the space moves to the Plus plan.
