# @yaks/speech

Speech to text, text to speech and speech to speech, with each provider given as
data. A `Provider` says where it answers, which models hear, speak and talk,
what each costs, and how its requests and streams are worded, all in its own
entry; one implementation calls any provider described that way. The key is an
argument; nothing here reads the environment.

- `DEEPGRAM`: Nova-3 hears a recording, Flux hears a call and says when a
  speaker's turn ends, and Aura-2 speaks. It has no model that talks.
- `OPENAI`: gpt-transcribe hears a recording and a call's turns, gpt-4o-mini-tts
  speaks (its 24 kHz PCM made μ-law for a call), gpt-realtime-2.1 and its mini
  hear and speak in one stream (`talk`), and gpt-live-1 hears and speaks at
  once, taking its own turns.

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
  realtime models 0.25 to 1.5; gpt-live-1 has only its own.
- `hear({provider, key, audio, type})` answers a recording's `text`, its length
  in `seconds`, and `dollars`.
- `turns({provider, key, format, told})` hears audio as it streams. `send` takes
  raw samples; `told.start()` fires when the speaker starts a turn (stop
  whatever is playing to them), `told.end(text)` when they finish one, and
  `told.lost(reason)` when the stream drops. `spent()` answers the seconds heard
  so far and their cost, and `close()` ends the stream answering the same.
- `talk({provider, key, format, instructions, tools?, model?, voice?, speed?, opens?, told})`
  is a model that hears and speaks itself, `model` one of a `provider.talk`
  entry's (`talkerOf(provider, model)`; the first by default), which is `Turned`
  or `Duplex`. A `Turned` one (the realtime models) takes a turn as it is told
  here. `send` takes the caller's raw samples; `told.audio(bytes)` is what to
  play them, `told.over()` that they talked over the model and what plays should
  stop (once their words say something, `meant`: an "okay", a laugh or a noise
  lets it go on, and the response under way is cancelled), `told.stopped()` ends
  their turn, when the model hears it end or once they are quiet 0.7 s. What the
  model says to it waits for their words, and is not said when they stopped
  where a sentence goes on (`open`: "the", "is", "um", a comma), when the model
  calls the stream's own `listen` tool, or when they talk again before it plays;
  a turn left unanswered is answered once they have been quiet 5 s. `told.heard`
  and `told.said` are each side's words, and `told.call(name, args)` answers a
  tool the model asked for with its output, before it goes on, and `told.done()`
  ends each of its responses. `say(text)` asks it to say something, and
  `tell(text)` tells it something it knows from now on without answering it;
  `spent()` answers the seconds heard and what the stream cost so far, and
  `close()` ends it answering the same, each response priced at its model's
  rates, or the stream's when it names none. A provider without the model
  refuses.
- `opens` is the model's first words, a call's greeting. Either kind of model is
  asked for them once as the stream opens, and the caller's audio reaches it as
  a quiet line (`muted`) until they have played: a hello the caller says over
  them, or the sound of the line picking up, is no turn for the model to answer
  with a greeting of its own. A `Turned` model writes them faster than they are
  said, so they have played once the line has run as long as they last; a
  `Duplex` one has said them once it spoke and was quiet 0.6 s. A model that
  begins none in 6 s hears the caller anyway. A call the provider's own line
  carries is asked for them too, its audio heard throughout.
- `first(format)` is that rule for whoever speaks a call's first words
  themselves, as a call around `turns` and `speak` does: `said(audio)` takes the
  words' audio as it is given to the line and `done()` that it all was, and
  `heard(audio)` answers the caller's audio as the listener should get it, quiet
  until the words have played.
- Asked to say given words (`opens`, `say`), a `Turned` model answers with no
  tool, and only its answer plays: gpt-realtime-2.1-mini sometimes says such
  words twice in one response, as a part before its answer and the answer.
- A `Duplex` one (gpt-live-1) hears and speaks at once and takes its own turns:
  it yields to the caller and waits through their pauses itself, and its audio
  comes as it is said, quiet and all, so nothing here stops it, ends a turn or
  asks for a response. Nothing is sent before its session started. Its words
  come a few at a time and are kept as lines, each side's ending when the other
  speaks; an answer's first sound ends the caller's turn as `told.stopped(ago)`,
  `ago` seconds back to their last sound. Its tools are whoever runs the call:
  work it hands over goes to `told.delegate(request)`, the caller's words since
  it last did, and what that answers it says in its own words, as it does what
  `say` asks. Given a `backend` (`{model, instructions, tools}`, one of the
  entry's `backends`: gpt-6-luna or gpt-6-sol), it hands its work to that larger
  model on the provider's side instead, which searches the web itself and calls
  `tools` through `told.call(name, args)`, each answer letting its work go on.
  It is priced by the minute, and its backend by the token.
- A call the provider's own line carries, sent to it over SIP, never passes its
  audio here. `talk.calls.rang(event)` reads the provider's webhook for the
  call's `id` and SIP `headers`; `accept({provider, key, call, …})` picks it up
  with the model set up as `talk` sets one up, and `reject` and `hangup` end it.
  `talk({…, call})` then joins it instead of streaming: no `format`, nothing to
  `send` and no `told.audio`; the caller talking over the model stops what plays
  on the line, `told.plays()` says the model's audio began playing, and
  `told.ended()` that the call ended (its stream closed cleanly). Its audio
  never heard here, a turn ends only when the model hears it end, and what the
  model says plays before the turn's words are heard. OpenAI's realtime models
  take calls this way.
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
