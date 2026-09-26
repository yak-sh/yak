---
doc:
  title: Voice
guide:
  slug: voice
  brief: the people in an app talk and hear each other
  description: >-
    Voice between the people in an app: a page joins a call through the app's
    own ./api/rtc/ door with @yaks/rtc, publishes the microphone, and hears the
    voices it asks for. Who is speaking is the `rtc` component on the entity
    they speak as, relayed to every page watching it. Playing a voice through an
    audio element or placing it in space with Web Audio, mute and talking, who
    may speak, and what an hour of listening costs against the space's monthly
    allowance.
---

# Voice

The map is at <https://yaks.app/docs.md>. This page is the whole of voice in an
app: joining a call, speaking, hearing, and what it costs.

An app needs no key and no server of its own for voice. Its pages talk through
the app's own door, `./api/rtc/`, which the platform keeps open onto Cloudflare
Realtime. The WebRTC half is a package the page imports:

    import { join, microphone } from 'https://esm.sh/jsr/@yaks/rtc@0.2.5'

## Speaking

A page joins as an entity: whatever the person is in the app, a player or a seat
at a table. `write` is how the page writes that entity, and it has to relay the
`rtc` component to the other pages rather than store it, which `@yaks/client`'s
`mutate` does:

    let call = await join({ entity: me, write: (b) => store.mutate(b) })
    talk.onclick = async () => await call.publish(await microphone())

The browser asks the person for the microphone, so publish from a click or a key
press. From then on the entity wears
`rtc { session, tracks: ['voice'], muted, talking }` on every page watching it,
and only while the tab is open: nobody keeps `rtc`, so it goes when the page
does.

- `call.mute(true)` stops sending without leaving, and `rtc.muted` says so.
- `rtc.talking` is true while the microphone hears a voice, for a page that
  draws who is speaking.
- `call.leave()` ends the call and clears `rtc`.
- `join({ change })` is told when the call moves: `live`, `lost` while it
  reconnects, `limit` when the allowance is spent, `refused` when this person
  may not speak here.

## Hearing

A page hears the voices it asks for and nobody else's, so it asks only for the
ones it wants: the people at the same table, or within earshot.

    let voice = await call.hear(them.rtc.session, 'voice')
    let out = new Audio()
    out.srcObject = voice.stream
    await out.play()

`voice.stop()` stops hearing it. A voice whose speaker left, or whose connection
was rebuilt, reads `voice.live == false`; ask for it again from the speaker's
new `rtc`.

To place a voice in space, feed the stream into Web Audio instead:

    let source = audio.createMediaStreamSource(voice.stream)
    source.connect(panner).connect(audio.destination)

The stream `hear` hands back is already playing through a muted `<audio>`, which
is what Chrome needs before Web Audio hears anything from it.

The browser's echo canceller hears what an `<audio>` element plays and not what
Web Audio plays: in Chrome, a voice placed in space comes back to its speaker
through a listener's loudspeakers. Headphones avoid it.

## Who may speak

Voice costs the space money, so by default only the app's members who may change
it speak and listen. An app that wants its visitors to talk too says so at the
top of its `vocab.json`:

    { "rtc": "open", "$defs": { … } }

Then anyone who may write the app may, which on an `open` app is anyone with the
link, at up to 60 calls to the door a minute each.

## What it costs

A voice is weighed as it is heard: about $0.001 for each voice a page hears for
an hour, and nothing for speaking. Ten people each hearing three others talk for
an hour is about $0.03.

Voice spends the same allowance as models: $0.20 a month on a free space, shared
by the free spaces its owner has, and $3.00 on the Plus plan. `app_list` says
how much of it the month has spent, and how much of that was voice. When it is
spent, a new call and a new voice are refused (`limit`), the voices already
heard go quiet within a minute, and everything else in the app keeps working.
Voice comes back on the 1st, or once the space moves to the Plus plan.
