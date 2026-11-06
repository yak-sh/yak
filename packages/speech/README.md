# @yaks/speech

Speech to text, text to speech and speech to speech, with each provider given as
data. A `Provider` says where it answers, which models hear, speak and talk,
what each costs, and how its requests and streams are worded, all in its own
entry; one implementation calls any provider described that way. The key is an
argument; nothing here reads the environment.

- `DEEPGRAM`: Nova-3 hears a recording, Flux hears a call and says when a
  speaker's turn ends, and Aura-2 speaks. It has no model that talks.
- `OPENAI`: gpt-transcribe hears a recording and a call's turns, gpt-4o-mini-tts
  speaks (its 24 kHz PCM made μ-law for a call), and gpt-realtime-2.1 and its
  mini hear and speak in one stream (`talk`).

## Speaking and hearing

- `speak({provider, key, text, voice?, format?, speed?})` answers the audio as
  it streams (`body`), its media type, and what it cost in `dollars`. `format`
  is `{encoding: 'mp3'}` (the default) or raw samples,
  `{encoding: 'mulaw' | 'linear16', rate}`, which come without a container,
  ready for a phone call. μ-law comes without the silence a provider pads a clip
  with, but 50 ms at each end (`trimmed`), so sentences said one clip at a time
  follow each other as closely at any speed.
- `speed` is a multiple of the provider's own pace (1 by default), held within
  the `speeds` each provider declares for speaking and for talking
  (`paced(speeds, speed)`): Aura-2 0.7 to 1.5, gpt-4o-mini-tts 0.25 to 4, the
  realtime models 0.25 to 1.5.
- `hear({provider, key, audio, type})` answers a recording's `text`, its length
  in `seconds`, and `dollars`.
- `turns({provider, key, format, told})` hears audio as it streams. `send` takes
  raw samples; `told.start()` fires when the speaker starts a turn (stop
  whatever is playing to them), `told.end(text)` when they finish one, and
  `told.lost(reason)` when the stream drops. `spent()` answers the seconds heard
  so far and their cost, and `close()` ends the stream answering the same.
- `talk({provider, key, format, instructions, tools?, model?, voice?, speed?, told})`
  is a model that hears and speaks itself. `send` takes the caller's raw
  samples; `told.audio(bytes)` is what to play them, `told.start()` and
  `told.stopped()` mark their turn, `told.heard` and `told.said` are each side's
  words, and `told.call(name, args)` answers a tool the model asked for with its
  output, before it goes on, and `told.done()` ends each of its responses.
  `say(text)` asks it to say something; `spent()` answers the seconds heard and
  what the stream cost so far, and `close()` ends it answering the same, each
  response priced at its model's rates, or the stream's when it names none. A
  provider without `talk` refuses.
- A stream's `open(url, {authorization, protocols})` makes its socket: by
  default the platform's `WebSocket`, offering the key as the provider's
  subprotocols; a host whose sockets take headers sends `authorization`.
- `provider.speak.voices` (and `provider.talk.voices`) list the voices it speaks
  in, each an `id` to pass as `voice`, a `name` and how it sounds (`about`).
- `balance({provider, key})` is the credit left on the account, in dollars, or
  undefined where the provider does not say.
- `spoken(provider, text)` and `heard(provider, seconds)` price speech before it
  is asked for.
- `mulawed(from, to)` turns a stream of 16-bit PCM into μ-law at a lower rate,
  and `trimmed(rate, keep?)` takes the silence off both ends of a μ-law stream;
  `base64` and `unbase64` carry audio in JSON.

A refusal rejects with `SpeechError`, carrying the provider's HTTP `status` and
its words; `retry` is true for a 429, a 5xx, or no answer at all.
