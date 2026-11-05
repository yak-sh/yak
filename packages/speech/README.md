# @yaks/speech

Speech to text and text to speech, with the provider given as data. A `Provider`
says where the provider answers, which models hear and speak, and what each
costs; one implementation calls any provider described that way. `DEEPGRAM` is
the one given today: Nova-3 hears a recording, Flux hears a call and says when a
speaker's turn ends, and Aura-2 speaks. The key is an argument; nothing here
reads the environment.

## Speaking and hearing

- `speak({provider, key, text, voice?, format?})` answers the audio as it
  streams (`body`), its media type, and what it cost in `dollars`. `format` is
  `{encoding: 'mp3'}` (the default) or raw samples,
  `{encoding: 'mulaw' |
  'linear16', rate}`, which come without a container,
  ready for a phone call.
- `hear({provider, key, audio, type})` answers a recording's `text`, its length
  in `seconds`, and `dollars`.
- `turns({provider, key, format, told})` hears audio as it streams. `send` takes
  raw samples; `told.start()` fires when the speaker starts a turn (stop
  whatever is playing to them), `told.end(text)` when they finish one, and
  `told.lost(reason)` when the stream drops. `close()` answers the seconds heard
  and their cost. `open` makes the socket, the platform's `WebSocket` offering
  the key as its subprotocol by default.
- `provider.voices` lists the voices it speaks in, each an `id` to pass as
  `voice`, a `name` and a line on how it sounds (`about`).
- `balance({provider, key})` is the credit left on the account, in dollars.
- `spoken(provider, text)` and `heard(provider, seconds)` price speech before it
  is asked for.

A refusal rejects with `SpeechError`, carrying the provider's HTTP `status` and
its words; `retry` is true for a 429, a 5xx, or no answer at all.
