// The Operator chat's microphone and spoken lines (public/voice.js), on a
// linkedom box with the browser's speech stood in for: what is heard goes
// into the box as typed words do and is sent once the person stops, the
// lines a step says are spoken only after a message that was talked, and a
// browser without speech of its own records for the platform to hear and
// plays the lines the platform says.
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { voice } from './public/voice.js'

type Said = { text: string; lang?: string }

let box = (
  o: {
    recognizes?: boolean
    voiced?: boolean
    paid?: boolean
    records?: boolean
  } = {},
) => {
  let { document, Event } = parseHTML(
    '<form id="ask"><textarea name="say"></textarea>' +
      '<button type="button" data-voice hidden><span data-voice-says>Talk</span></button></form>',
  )
  let form = document.querySelector('form')! as unknown as HTMLFormElement
  let say = document.querySelector(
    'textarea',
  )! as unknown as HTMLTextAreaElement
  let button = document.querySelector('[data-voice]')! as unknown as HTMLElement
  let sent: string[] = [], typed: string[] = [], told: string[] = []
  say.addEventListener('input', () => typed.push(say.value))
  form.requestSubmit = () => {
    sent.push(say.value)
    form.dispatchEvent(new Event('submit'))
    say.value = ''
  }
  // The one recognition listening, which a test speaks for.
  let heard: {
    onresult?: (e: unknown) => void
    onerror?: (e: unknown) => void
    onend?: () => void
    lang?: string
  } | null = null
  let spoken: string[] = [], quieted = 0
  let posted: { url: string; body: unknown }[] = []
  let played: string[] = []
  let recorder:
    | { onstop?: () => void; ondataavailable?: (e: unknown) => void }
    | null = null
  let tracks = 0
  let platform = {
    Recognition: o.recognizes == false ? undefined : class {
      lang = ''
      interimResults = false
      constructor() {
        heard = this
      }
      start() {}
      stop() {
        heard?.onend?.()
      }
    },
    synthesis: o.voiced == false ? undefined : {
      speak: (u: Said) => void (u.text && spoken.push(u.text)),
      cancel: () => void quieted++,
    } as unknown as SpeechSynthesis,
    Utterance: class {
      lang = ''
      constructor(public text: string) {}
    } as unknown as typeof SpeechSynthesisUtterance,
    media: o.records
      ? {
        getUserMedia: () =>
          Promise.resolve({ getTracks: () => [{ stop: () => void tracks++ }] }),
      } as unknown as MediaDevices
      : undefined,
    Recorder: o.records
      ? class {
        state = 'inactive'
        mimeType = 'audio/webm;codecs=opus'
        onstop?: () => void
        ondataavailable?: (e: unknown) => void
        constructor() {
          recorder = this
        }
        start() {
          this.state = 'recording'
        }
        stop() {
          this.state = 'inactive'
          this.ondataavailable?.({ data: new Blob([new Uint8Array([7])]) })
          this.onstop?.()
        }
      } as unknown as typeof MediaRecorder
      : undefined,
    fetch: ((url: string, init: RequestInit) => {
      posted.push({
        url,
        body: init.body instanceof Blob ? init.body.type : init.body,
      })
      return Promise.resolve(
        url.includes('hear')
          ? Response.json({ text: 'Make the header warmer' })
          : new Response(
            new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
          ),
      )
    }) as typeof fetch,
    Audio: class {
      onended?: () => void
      onerror?: () => void
      onpause?: () => void
      constructor(public src: string) {}
      play() {
        played.push(this.src)
        queueMicrotask(() => this.onended?.())
        return Promise.resolve()
      }
      pause() {}
    } as unknown as typeof Audio,
    lang: 'en-GB',
    setTimeout: (() => 0) as unknown as typeof setTimeout,
    Event: Event as unknown as typeof globalThis.Event,
  }
  let talk = voice({
    button,
    form,
    say,
    at: '/manage/choir/operator',
    paid: o.paid ?? false,
    said: (e: Error) => void told.push(e.message),
    platform,
  })
  return {
    button,
    say,
    sent,
    typed,
    told,
    spoken,
    posted,
    played,
    tracks: () => tracks,
    quieted: () => quieted,
    talk,
    press: () => button.dispatchEvent(new Event('click')),
    listening: () => heard,
    // The browser hearing `words` so far, then the person stopping.
    hears: (...words: string[]) =>
      heard!.onresult!({ results: words.map((w) => [{ transcript: w }]) }),
    ends: () => heard!.onend!(),
    refuses: (error: string) => heard!.onerror!({ error }),
    recording: () => recorder,
    type: (text: string) => {
      say.value = text
      form.dispatchEvent(new Event('submit'))
    },
  }
}
let settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((ok) => setTimeout(ok, 0))
}

test('the microphone shows only where the browser or the platform can hear', () => {
  equal(box().button.hidden, false)
  equal(box({ recognizes: false }).button.hidden, true)
  equal(box({ recognizes: false, records: true }).button.hidden, true)
  equal(
    box({ recognizes: false, records: true, paid: true }).button.hidden,
    false,
  )
})

test('what is heard goes into the box after what was typed, as the draft, and is sent once the person stops', () => {
  let b = box()
  b.say.value = 'Recipes:'
  b.press()
  equal(b.button.getAttribute('aria-pressed'), 'true')
  equal(b.button.textContent, 'Listening')
  equal(b.listening()!.lang, 'en-GB')
  b.hears('make the ')
  b.hears('make the ', 'header warmer')
  equal(b.typed, ['Recipes: make the', 'Recipes: make the header warmer'])
  equal(b.sent, [])
  b.ends()
  equal(b.sent, ['Recipes: make the header warmer'])
  equal(b.button.getAttribute('aria-pressed'), 'false')
  equal(b.button.textContent, 'Talk')
})

test('pressing again while listening sends what was heard so far', () => {
  let b = box()
  b.press()
  b.hears('go back')
  b.press()
  equal(b.sent, ['go back'])
})

test('nothing heard sends nothing, and a blocked microphone says so', () => {
  let b = box()
  b.press()
  b.ends()
  equal(b.sent, [])
  equal(b.told, [])
  b.press()
  b.refuses('not-allowed')
  b.ends()
  equal(b.sent, [])
  equal(b.told, [
    'The microphone is blocked for this page. Allow it in your browser’s settings to talk.',
  ])
})

test('a talked message is answered aloud, a typed one quietly, and a press quiets what is said', () => {
  let b = box()
  b.talk.tell(['Wrote the files of recipes'])
  equal(b.spoken, [])
  b.press()
  b.hears('make it warmer')
  b.ends()
  b.talk.tell(['Wrote styles.css', 'Done. It is warmer now.'])
  equal(b.spoken, ['Wrote styles.css', 'Done. It is warmer now.'])
  let quiet = b.quieted()
  b.press()
  equal(b.quieted(), quiet + 1)
  // nothing is said over the person while they talk
  b.talk.tell(['Released recipes'])
  equal(b.spoken.length, 2)
  b.ends()
  b.type('Thanks')
  b.talk.tell(['Released recipes'])
  equal(b.spoken.length, 2)
})

test('a browser without speech records for the platform to hear, and plays what it says', async () => {
  let b = box({ recognizes: false, voiced: false, records: true, paid: true })
  b.say.value = 'Please'
  b.press()
  equal(b.button.textContent, 'Listening')
  await settle()
  b.press()
  equal(b.button.textContent, 'Hearing…')
  await settle()
  equal(b.posted[0], {
    url: '/manage/choir/operator?hear=1',
    body: 'audio/webm;codecs=opus',
  })
  equal(b.tracks(), 1)
  equal(b.sent, ['Please Make the header warmer'])
  equal(b.button.textContent, 'Talk')
  b.talk.tell(['Released recipes', 'Done.'])
  await settle()
  equal(b.posted.slice(1), [
    {
      url: '/manage/choir/operator?speak=1',
      body: '{"text":"Released recipes"}',
    },
    { url: '/manage/choir/operator?speak=1', body: '{"text":"Done."}' },
  ])
  equal(b.played.length, 2)
})

test('a press before the browser gives the microphone lets it go unused', async () => {
  let b = box({ recognizes: false, records: true, paid: true })
  b.press()
  b.press()
  await settle()
  equal(b.tracks(), 1)
  equal(b.recording(), null)
  equal(b.button.textContent, 'Talk')
})
