// The workflow's code steps (seed.json holds the steps themselves). Each route
// is posted one match of its step's query as `binding` and answers the rows it
// makes as `outputs`; the store writes them, and the next step's query matches
// them. Voices come from ElevenLabs through ./api/speech, asked as the app
// itself (`env.APP`), and every voiced take is kept at ./api/blob.

let CANDIDATES = 3

/** The steps, over `api`: a fetch onto the app's own /api/ (env.APP). */
export let steps = (api) => {
  let ask = async (path, init) => {
    let res = await api.fetch(path, init)
    if (res.ok) return res
    let said = await res.json().catch(() => null)
    throw Object.assign(
      new Error(said?.error?.message ?? `${path} answered ${res.status}`),
      { status: res.status },
    )
  }
  // `text` said in `voice`, kept as an MP3 of the app's: its blob's eid.
  let say = async (voice, text) => {
    let spoken = await ask('speech/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'elevenlabs', voice, text }),
    })
    let kept = await ask('blob', {
      method: 'POST',
      headers: { 'content-type': 'audio/mpeg' },
      body: await spoken.arrayBuffer(),
    })
    return (await kept.json()).eid
  }
  let members = (binding, i) => binding.collections?.[i]?.members ?? []

  return {
    // One character: the voices whose descriptions share the most words with
    // how it sounds each say its first line, and a decision asks the person
    // who asked for the video which to use, in their Updates. The next step
    // reads their answer, `decided.choice`.
    audition: async (binding) => {
      let [role] = binding.entities
      let { about, name, asker } = binding.vars
      let first = members(binding, 0)
        .map((m) => m.vars)
        .toSorted((a, b) => a.n - b.n)[0]
      if (!first) return { outputs: [] }
      let { voices } = await (await ask('speech/voices?provider=elevenlabs'))
        .json()
      let picked = cast(about, voices)
      if (picked.length < 2) {
        throw Object.assign(
          new Error('ElevenLabs offered fewer than two voices to audition'),
          { status: 409 },
        )
      }
      let takes = await Promise.all(
        picked.map(async (v) => ({ ...v, audio: await say(v.id, first.said) })),
      )
      return {
        outputs: [
          ...takes.map((v, i) => ({
            slot: `audition ${i + 1}`,
            inputs: [role],
            components: {
              audition: { role, voice: v.id, name: v.name, audio: v.audio },
            },
          })),
          {
            slot: 'choice',
            inputs: [role],
            components: {
              task: {},
              // Asked in the Updates of the person who asked for the video.
              filed: { assignee: asker },
              decision: {
                question: `Which voice should say ${name}'s lines?`,
                choices: takes.map((v) => ({
                  label: v.name,
                  description: v.about || `${v.name} saying “${first.said}”`,
                })),
                recommended: takes[0].name,
              },
              cast: { role },
              doc: { title: `Voice for ${name}` },
            },
          },
        ],
      }
    },

    // One line, in the voice chosen for its character.
    voice: async (binding) => {
      let [line] = binding.entities
      let { video, n, text, who, voice } = binding.vars
      return {
        outputs: [{
          slot: 'voiced',
          inputs: [line],
          components: {
            voicing: { video, line, n, audio: await say(voice, text) },
            doc: { title: who, body: text },
          },
        }],
      }
    },

    // The video's cut, once every current line has its voicing; until then
    // it answers nothing, and the next voicing asks again.
    assemble: (binding) => {
      let [video] = binding.entities
      let lines = members(binding, 0)
      let clips = members(binding, 1)
        .map(({ vars: { n, who, text, audio } }) => ({ n, who, text, audio }))
        .toSorted((a, b) => a.n - b.n)
      if (!lines.length || clips.length < lines.length) return { outputs: [] }
      return {
        outputs: [{
          slot: 'cut',
          inputs: [video],
          components: {
            cut: { video, clips },
            doc: { title: binding.vars.title },
          },
        }],
      }
    },
  }
}

let words = (text) => new Set(String(text ?? '').toLowerCase().match(/\w+/g))

/** The `count` voices whose descriptions share the most words with `about`,
 * each name once, in the order ElevenLabs listed them where they tie. */
export let cast = (about, voices, count = CANDIDATES) => {
  let wanted = words(about)
  let score = (v) => [...words(v.about)].filter((w) => wanted.has(w)).length
  let named = new Set()
  return voices
    .map((v, i) => ({ v, i, s: score(v) }))
    .toSorted((a, b) => b.s - a.s || a.i - b.i)
    .map(({ v }) => v)
    .filter((v) => !named.has(v.name) && named.add(v.name))
    .slice(0, count)
}

let ROUTES = {
  '/audition': 'audition',
  '/voice': 'voice',
  '/assemble': 'assemble',
}

export default {
  async fetch(request, env) {
    let path = new URL(request.url).pathname
    let route = Object.keys(ROUTES).find((r) => path.endsWith(r))
    if (!route || request.method != 'POST') {
      return new Response('Not found', { status: 404 })
    }
    let { binding } = await request.json()
    try {
      return Response.json(await steps(env.APP)[ROUTES[route]](binding))
    } catch (e) {
      // The platform's no (ElevenLabs not connected, the budget spent) is
      // passed on as the step's own refusal, kept on its build as the reason.
      if (!(e.status >= 400 && e.status < 500)) throw e
      return Response.json({ error: { message: e.message } }, {
        status: e.status,
      })
    }
  },
}
