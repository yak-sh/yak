// Talking to the Operator (operator-page.ts `chatScript`): its message box's
// microphone, and the short lines it says back. Pressing the microphone
// listens; what is heard is written into the box as it is said, so it is the
// person's draft like anything typed (@yaks/draft), and once they stop it is
// sent. Pressing it again sends what was heard so far. A message sent by
// talking is answered aloud, one line for each change that lands and the
// first sentences of each reply (operator-view.ts `aloud`); one typed is
// answered quietly.
//
// The browser hears and speaks itself where it can (SpeechRecognition,
// speechSynthesis), which costs nothing. Where it can't, and the platform's
// speech is on (`paid`), the page records and the Operator page hears it,
// and says each line in the Operator's own voice, both charged to the
// space's budget (operator-page.ts `?hear`, `?speak`). With neither, the
// microphone stays hidden. Served as it is written, as follow.js is.

// The longest a recording the platform hears may run.
let MINUTE = 60_000

/**
 * @typedef {{
 *   Recognition?: any,
 *   synthesis?: SpeechSynthesis,
 *   Utterance?: typeof SpeechSynthesisUtterance,
 *   media?: MediaDevices,
 *   Recorder?: typeof MediaRecorder,
 *   fetch: typeof fetch,
 *   Audio?: typeof Audio,
 *   lang: string,
 *   setTimeout: typeof setTimeout,
 *   Event: typeof Event,
 * }} Platform
 */

/** What this browser has to hear and speak with. @returns {Platform} */
let browser = () => {
  let g = /** @type {any} */ (globalThis)
  return {
    Recognition: g.SpeechRecognition ?? g.webkitSpeechRecognition,
    synthesis: g.speechSynthesis,
    Utterance: g.SpeechSynthesisUtterance,
    media: g.navigator?.mediaDevices,
    Recorder: g.MediaRecorder,
    fetch: g.fetch.bind(g),
    Audio: g.Audio,
    lang: g.document?.documentElement.lang || g.navigator?.language || 'en',
    setTimeout: g.setTimeout.bind(g),
    Event: g.Event,
  }
}

// What a browser's refusal to listen means to the person.
/** @type {Record<string, string>} */
let REFUSED = {
  'not-allowed':
    'The microphone is blocked for this page. Allow it in your browser’s settings to talk.',
  'service-not-allowed':
    'This browser won’t listen here. Type instead, or try another browser.',
  'audio-capture': 'No microphone was found.',
  network: 'What you said could not be heard just now. Try again, or type it.',
}

// A door's own words for what went wrong, or `fallback`.
/** @param {Response} r @param {string} fallback */
let failure = async (r, fallback) =>
  new Error((await r.json().catch(() => null))?.message ?? fallback)

/**
 * Wire the microphone `button` to the message box `say` of `form`, and
 * answer with `tell`, which says a frame's lines aloud while the person is
 * talking.
 *
 * @param {{
 *   button: HTMLElement,
 *   form: HTMLFormElement,
 *   say: HTMLTextAreaElement,
 *   at: string,
 *   paid: boolean,
 *   said: (e: Error) => void,
 *   platform?: Platform,
 * }} o
 */
export function voice({ button, form, say, at, paid, said, platform }) {
  let p = platform ?? browser()
  let records = paid && !!p.media?.getUserMedia && !!p.Recorder
  let voiced = !!p.synthesis && !!p.Utterance
  if (!p.Recognition && !records) return { tell: () => {} }
  button.hidden = false
  let label = button.querySelector('[data-voice-says]') ?? button

  // 'idle', 'listening', or 'hearing' while the platform hears a recording.
  let state = 'idle'
  /** @type {null | (() => void)} */
  let stop = null
  let show = (now = 'idle') => {
    state = now
    button.setAttribute('aria-pressed', String(now == 'listening'))
    button.toggleAttribute('data-listening', now == 'listening')
    label.textContent = now == 'listening'
      ? 'Listening'
      : now == 'hearing'
      ? 'Hearing…'
      : 'Talk'
  }

  // What is heard is put after what the box held, and kept as the draft.
  /** @param {string} before @param {string} words */
  let put = (before, words) => {
    say.value = [before, words.trim()].filter(Boolean).join(' ')
    say.dispatchEvent(new p.Event('input', { bubbles: true }))
  }
  // Whether the message being sent was talked; the next one typed is quiet.
  let talked = false, talking = false
  form.addEventListener('submit', () => {
    talking = talked
    talked = false
  })
  let send = () => {
    talked = true
    form.requestSubmit()
  }

  let listen = () => {
    let before = say.value.trim()
    let r = new p.Recognition()
    r.lang = p.lang
    r.interimResults = true
    let words = '', refused = ''
    r.onresult = (/** @type {any} */ e) => {
      words = [...e.results].map((x) => x[0].transcript).join('')
      put(before, words)
    }
    r.onerror = (/** @type {any} */ e) => {
      refused = REFUSED[e.error] ?? ''
    }
    r.onend = () => {
      stop = null
      show()
      if (refused) said(new Error(refused))
      else if (words.trim()) send()
    }
    r.start()
    stop = () => r.stop()
    show('listening')
  }

  // It listens from the press, while the browser asks for the microphone; a
  // press before it is given lets it go unused.
  let record = async () => {
    let before = say.value.trim()
    let stream, wanted = true
    stop = () => void (wanted = false)
    show('listening')
    try {
      stream = await p.media.getUserMedia({ audio: true })
    } catch {
      stop = null
      show()
      return said(new Error(REFUSED['not-allowed']))
    }
    if (!wanted) {
      for (let track of stream.getTracks()) track.stop()
      stop = null
      return show()
    }
    let recorder = new p.Recorder(stream)
    /** @type {Blob[]} */
    let parts = []
    recorder.ondataavailable = (/** @type {BlobEvent} */ e) =>
      parts.push(e.data)
    recorder.onstop = async () => {
      for (let track of stream.getTracks()) track.stop()
      stop = null
      show('hearing')
      try {
        let audio = new Blob(parts, { type: recorder.mimeType || 'audio/webm' })
        let r = await p.fetch(at + '?hear=1', {
          method: 'POST',
          headers: { 'content-type': audio.type },
          body: audio,
        })
        if (!r.ok) {
          throw await failure(r, REFUSED.network)
        }
        let { text } = await r.json()
        put(before, text)
        show()
        if (String(text).trim()) send()
      } catch (e) {
        show()
        said(/** @type {Error} */ (e))
      }
    }
    recorder.start()
    stop = () => recorder.state != 'inactive' && recorder.stop()
    p.setTimeout(() => stop?.(), MINUTE)
  }

  // Lines are said one after another; `hush` drops those not yet said.
  let queue = Promise.resolve(), round = 0
  /** @type {HTMLAudioElement | null} */
  let playing = null
  let hush = () => {
    round++
    p.synthesis?.cancel()
    playing?.pause()
    playing = null
    queue = Promise.resolve()
  }
  /** @param {string} line */
  let fetched = async (line) => {
    let r = await p.fetch(at + '?speak=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: line }),
    })
    if (!r.ok) throw await failure(r, 'The Operator could not be heard.')
    return URL.createObjectURL(await r.blob())
  }
  /** @param {string} line */
  let aloud = (line) => {
    if (voiced) {
      let u = new p.Utterance(line)
      u.lang = p.lang
      return void p.synthesis.speak(u)
    }
    if (!paid || !p.Audio) return
    let mine = round
    let sound = fetched(line)
    queue = queue.then(async () => {
      let src = await sound
      if (mine != round) return URL.revokeObjectURL(src)
      let audio = playing = new p.Audio(src)
      await new Promise((done) => {
        audio.onended = audio.onerror = audio.onpause = done
        audio.play().catch(done)
      })
      URL.revokeObjectURL(src)
    }).catch(said)
  }

  // A phone speaks only once a press has let it, so the first press says
  // nothing aloud, and every press quiets what is being said.
  let unlocked = false
  button.addEventListener('click', () => {
    if (state == 'hearing') return
    if (stop) return stop()
    hush()
    if (voiced && !unlocked) {
      unlocked = true
      p.synthesis.speak(new p.Utterance(''))
    }
    if (p.Recognition) listen()
    else record()
  })
  show()

  return {
    /** Say `lines` aloud, if the message they answer was talked.
     * @param {string[]} lines */
    tell: (lines) => {
      if (talking && state == 'idle') { for (let line of lines) aloud(line) }
    },
  }
}
