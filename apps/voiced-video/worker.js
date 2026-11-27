// The workflow's code steps (seed.json holds the steps themselves, rows of
// @yaks/workflow). Each step writes a call to one of these commands; the
// command reads what it needs and writes what it makes through the app's own
// /api/ (`env.APP`): a model through ./api/ai/run, voices through
// ./api/speech, every voiced take kept at ./api/blob.
//
// Filming a shot and rendering the finished file are the studio's
// (studio.ts): those steps write a `take` or a `film` task it answers.

import { mp3ms, timeline } from './model.js'

let MODEL = '@cf/zai-org/glm-5.3'
let CANDIDATES = 3
// What a thousand characters cost to say, in dollars, at each provider's
// price (@yaks/speech's `perThousand`).
let PER_THOUSAND = { elevenlabs: 0.08, deepgram: 0.03, openai: 0.015 }
// The providers voices are auditioned from: a space's own ElevenLabs where
// it is connected, else the platform's.
let PROVIDERS = [['elevenlabs'], ['deepgram', 'openai']]

/** The steps, over `api`: a fetch onto the app's own /api/ (env.APP). */
export let steps = (api) => {
  let ask = async (path, init) => {
    let res = await api.fetch(path, init)
    if (res.ok) return res
    let said = await res.json().catch(() => null)
    throw Object.assign(
      new Error(
        said?.error?.message ?? said?.message ??
          `${path} answered ${res.status}`,
      ),
      { status: res.status },
    )
  }
  let post = (path, body) =>
    ask(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  let read = async (q) =>
    await (await ask(`query?q=${encodeURIComponent(q)}`)).json()
  let one = async (eid) => (await read(`.eid=${eid}&*`))[0]
  let write = (bundles) => bundles.length && post('apply', bundles)
  let gone = (rows) =>
    rows.map((r) => ({ entity: { eid: r.entity.eid }, tombstone: {} }))
  let model = async (prompt) => {
    let said = await (await post('ai/run', {
      model: MODEL,
      input: {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
      },
    })).json()
    return json(said.response)
  }
  // `text` said in `voice`, kept as an MP3 of the app's: its blob and length.
  let say = async (provider, voice, text) => {
    let spoken = await post('speech/speak', { provider, voice, text })
    let bytes = new Uint8Array(await spoken.arrayBuffer())
    let kept = await ask('blob', {
      method: 'POST',
      headers: { 'content-type': 'audio/mpeg' },
      body: bytes,
    })
    return {
      audio: (await kept.json()).eid,
      ms: mp3ms(bytes),
      dollars: (PER_THOUSAND[provider] ?? 0) * text.length / 1000,
    }
  }
  let voices = async () => {
    for (let names of PROVIDERS) {
      let found = await Promise.all(names.map(async (provider) => {
        let res = await api.fetch(`speech/voices?provider=${provider}`)
        if (!res.ok) return []
        return (await res.json()).voices.map((v) => ({ ...v, provider }))
      }))
      if (found.flat().length) return found.flat()
    }
    return []
  }
  let ref = (v) => typeof v == 'string' ? v : v?.eid

  return {
    // The video's voices and lines, from its title and what it is about.
    // A script written again replaces the last in the same write.
    script: async ({ video }) => {
      let v = await one(video)
      let script = await model(scriptPrompt(v))
      let roles = (script.roles ?? []).map((r, i) => ({
        entity: { eid: `$role${i}` },
        role: { video, about: String(r.about ?? '') },
        doc: { title: String(r.name ?? `Voice ${i + 1}`) },
      }))
      let named = new Map(roles.map((r) => [r.doc.title, r.entity.eid]))
      let lines = (script.lines ?? []).map((l, i) => ({
        entity: { eid: `$line${i}` },
        line: {
          video,
          role: named.get(l.role) ?? roles[0]?.entity.eid,
          n: i + 1,
        },
        doc: { body: String(l.text ?? '') },
      }))
      await write([
        ...gone(await read(`.role.video=${video}`)),
        ...gone(await read(`.line.video=${video}`)),
        ...roles,
        ...lines,
      ])
      return { roles: roles.length, lines: lines.length }
    },

    // The shots shown while the lines are said, each line placed in one.
    storyboard: async ({ video }) => {
      let v = await one(video)
      let lines = (await read(`.line.video=${video}&?line&?doc`))
        .toSorted((a, b) => a.line.n - b.line.n)
      let board = await model(storyboardPrompt(v, lines))
      let shots = (board.shots ?? []).map((s, i) => ({
        entity: { eid: `$shot${i}` },
        shot: {
          video,
          n: i + 1,
          kind: s.kind == 'still' ? 'still' : 'browse',
          page: String(s.page ?? '/'),
          as: String(s.as ?? 'stranger'),
          steps: Array.isArray(s.steps) ? s.steps : [],
          ...s.after ? { after: Math.round(Number(s.after)) } : {},
        },
        doc: { title: String(s.title ?? `Shot ${i + 1}`) },
      }))
      let shotOf = new Map(
        (board.shots ?? []).flatMap((s, i) =>
          (s.lines ?? []).map((n) => [Number(n), i + 1])
        ),
      )
      await write([
        ...gone(await read(`.shot.video=${video}`)),
        ...shots,
        ...lines.map((l) => ({
          entity: l.entity,
          line: { shot: shotOf.get(l.line.n) ?? shots.length },
        })),
      ])
      return { shots: shots.length }
    },

    // One role: the voices whose descriptions share the most words with
    // how it sounds each say its first line, and a decision asks the person
    // who asked for the video which to use, in their Updates. The voice
    // step reads their answer, `decided.choice`.
    audition: async ({ role, asker }) => {
      let r = await one(role)
      let first = (await read(`.line.role=${role}&?line&?doc`))
        .toSorted((a, b) => a.line.n - b.line.n)[0]
      if (!first) return { auditions: 0 }
      let picked = cast(r.role.about, await voices())
      if (picked.length < 2) {
        throw Object.assign(new Error('fewer than two voices to audition'), {
          status: 409,
        })
      }
      let takes = await Promise.all(picked.map(async (v) => ({
        ...v,
        ...await say(v.provider, v.id, first.doc.body),
      })))
      let name = r.doc?.title ?? 'this voice'
      let old = await read(`.audition.role=${role}`)
      let asked = await read(`.cast.role=${role}`)
      await write([
        ...gone([...old, ...asked]),
        ...takes.map((v, i) => ({
          entity: { eid: `$take${i}` },
          audition: {
            role,
            provider: v.provider,
            voice: v.id,
            name: v.name,
            audio: v.audio,
          },
        })),
        {
          entity: { eid: '$choice' },
          task: {},
          // Asked in the Updates of the person who asked for the video.
          ...asker ? { filed: { assignee: asker } } : {},
          decision: {
            question: `Which voice should say ${name}'s lines?`,
            choices: takes.map((v) => ({
              label: v.name,
              description: v.about || `${v.name} saying “${first.doc.body}”`,
            })),
            recommended: takes[0].name,
          },
          cast: { role },
          doc: { title: `Voice for ${name}` },
        },
      ])
      return { auditions: takes.length }
    },

    // One line, in the voice chosen for its role. A line said again
    // replaces what it said before.
    voice: async ({ line, provider, voice }) => {
      let l = await one(line)
      let r = await one(ref(l.line.role))
      let said = await say(provider, voice, l.doc.body)
      await write([
        ...gone(await read(`.voicing.line=${line}`)),
        {
          entity: { eid: '$voiced' },
          voicing: {
            video: ref(l.line.video),
            line,
            n: l.line.n,
            voice: `${provider}/${voice}`,
            ...said,
          },
          doc: { title: r?.doc?.title ?? '', body: l.doc.body },
        },
      ])
      return { ms: said.ms }
    },

    // The cut: each shot with the lines said over it, timed. It runs once
    // every line is voiced and every shot filmed (seed.json).
    assemble: async ({ video }) => {
      let v = await one(video)
      let [lines, shots, voicings, takes] = await Promise.all(
        ['line', 'shot', 'voicing', 'take'].map((c) =>
          read(`.${c}.video=${video}&*`)
        ),
      )
      let cut = timeline({ lines, shots, voicings, takes })
      await write([
        ...gone(await read(`.cut.video=${video}`)),
        {
          entity: { eid: '$cut' },
          cut: { video, ...cut },
          doc: { title: v.doc?.title ?? '' },
        },
      ])
      return { ms: cut.ms }
    },
  }
}

/** A model's answer read as JSON, whether or not it fenced it. */
export let json = (text) => {
  let s = String(text ?? '')
  let start = s.indexOf('{'), end = s.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('the model answered no JSON')
  return JSON.parse(s.slice(start, end + 1))
}

let scriptPrompt = (v) =>
  `Write the voice-over script for a short video.
Title: ${v.doc?.title ?? ''}
What it says and shows: ${v.doc?.body ?? ''}
Length: about ${
    v.video?.seconds ?? 45
  } seconds said aloud, at about 2.5 words a second.

Use one or two voices. Each line is one or two short sentences a voice actor can say, plain and concrete, with no stage directions. Say only what the description supports; invent no customers, names, numbers or features.

Answer JSON only: {"roles": [{"name": "...", "about": "how the voice sounds, in a few plain words such as \\"warm, calm, woman\\""}], "lines": [{"role": "<a role's name>", "text": "..."}]}`

let storyboardPrompt = (v, lines) =>
  `Plan the shots for a short video: browser recordings of web pages, shown while the script's lines are said.
Title: ${v.doc?.title ?? ''}
What it says and shows: ${v.doc?.body ?? ''}

The script:
${lines.map((l) => `${l.line.n}. ${l.doc?.body ?? ''}`).join('\n')}

Film only the pages and actions the description names. Each shot is one page opened in a browser and the steps taken on it, filmed. Steps are objects, in order: {"wait": ms}, {"tap": "<css selector>"}, {"type": "<text>", "into": "<css selector>"}, {"press": "Enter"}, {"swipe": [x1, y1, x2, y2]}, {"eval": "<js run in the page, such as window.scrollBy({top: 400, behavior: 'smooth'})>"}. Give each shot enough waits to last while its lines are said. "after" is how many seconds to wait before filming a shot, for something an earlier shot started to finish. "as" is who opens the page: the account the description names, or "stranger".

Answer JSON only: {"shots": [{"title": "what it shows", "kind": "browse", "page": "<path or https address>", "as": "...", "steps": [...], "after": 0, "lines": [<the numbers of the lines said over it>]}]}`

let words = (text) => new Set(String(text ?? '').toLowerCase().match(/\w+/g))

/** The `count` voices whose descriptions share the most words with `about`,
 * each name once, in the order they were listed where they tie. */
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
  '/script': 'script',
  '/storyboard': 'storyboard',
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
    let args = await request.json()
    try {
      return Response.json(await steps(env.APP)[ROUTES[route]](args))
    } catch (e) {
      // The platform's no (a provider not connected, the budget spent) is
      // passed on as the step's own refusal, kept on its call.
      if (!(e.status >= 400 && e.status < 500)) throw e
      return Response.json({ error: { message: e.message } }, {
        status: e.status,
      })
    }
  },
}
