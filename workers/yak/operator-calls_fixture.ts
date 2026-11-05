// A call on gpt-realtime-2.1-mini as its stream told it, 2026-11-05: the
// greeting, small talk, then a question that needs a tool, asked of the
// Operator and its answer said. Only what @yaks/speech reads of each message
// is kept, and each response's audio is cut to two bytes.
let audio = { type: 'response.output_audio.delta', delta: 'f38=' }
let done = {
  type: 'response.done',
  response: {
    model: null,
    usage: {
      input_token_details: { text_tokens: 534, audio_tokens: 40 },
      output_token_details: { text_tokens: 58, audio_tokens: 31 },
    },
  },
}
let turn = (heard: string) => [
  { type: 'input_audio_buffer.speech_started' },
  { type: 'input_audio_buffer.speech_stopped' },
  {
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: heard,
  },
]
let said = (transcript: string) => [
  audio,
  { type: 'response.output_audio_transcript.done', transcript },
]

export let HELLO = [...said("Hi, it's Elihu."), done]
export let SMALL_TALK = [
  ...turn('Hi Ellihu, how are you this evening?'),
  ...said(
    'Good evening. I’m well, thank you. Ready to assist with anything you need.',
  ),
  done,
]
export let ASKED = [
  ...turn('Hi, Ellahu, do any of my apps have errors right now?'),
  ...said('Certainly, one moment.'),
  {
    type: 'response.function_call_arguments.done',
    call_id: 'call_Gx7AcRPt9P8OTiLI',
    name: 'ask',
    arguments:
      '{"request":"Hi Elihu, do any of my apps have errors right now?"}',
  },
  done,
]
export let ANSWERED = [...said('You have one open error in Mossvale.'), done]
