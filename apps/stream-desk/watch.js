// The Operator's eyes and ears at the desk: every `LOOK` the desk takes a
// still of each shot's scene from OBS, and with the last minute of what was
// said and the shot on air, asks a vision model which shot should be on air.
// A different shot is written as a cue marked `suggested{why}`, which the desk
// does not play until a person takes it.
import { idOf } from './model.js'

/** How often the desk looks, how much of what was said it sends, and how
 * wide each still is. */
export let LOOK = 10_000
export let HEARD = 60
export let WIDTH = 512

/** The vision model the desk asks (models.md, "Image input"). */
export let MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'

/** The scenes worth a still: each shot's scene, once. */
export let scenesOf = (shots) => [
  ...new Set(shots.map((s) => s.shot.scene).filter(Boolean)),
]

/** A still of each scene, as OBS renders it, whether or not it is on air. */
export let stills = (obs, scenes) =>
  Promise.all(scenes.map(async (scene) => {
    let { imageData } = await obs.call('GetSourceScreenshot', {
      sourceName: scene,
      imageFormat: 'jpg',
      imageWidth: WIDTH,
      imageCompressionQuality: 60,
    })
    return { scene, image: imageData }
  }))

/** The words said in the last `HEARD` seconds, oldest first. */
export let recent = (turns, now) =>
  turns.filter((t) => now - t.to <= HEARD).map((t) => t.text).join(' ')

/** The request for one look: the shots, the one on air, what was said, and a
 * still of each scene. */
export let ask = ({ shots, lit, said, seen }) => ({
  model: MODEL,
  input: {
    max_tokens: 120,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'You run the cameras for a livestream of a worship service. ' +
            'Pick the shot that should be on air now.',
            'Shots, by name: ' +
            shots.map((s) =>
              `${s.doc?.title} (scene ${s.shot.scene}${
                s.shot.preset ? `, camera preset ${s.shot.preset}` : ''
              })`
            ).join('; ') + '.',
            `On air: ${
              shots.find((s) => s.entity.eid == lit)?.doc?.title ?? 'unknown'
            }.`,
            `Said in the last minute: ${said || '(nothing heard)'}`,
            'A still of each scene follows, in this order: ' +
            seen.map((s) => s.scene).join(', ') + '.',
            'Change shots only for a clear reason: lyrics or slides on the ' +
            'projector during singing, a speaker at the pulpit, a reading. ' +
            'Answer only JSON: {"shot": "<shot name>", "why": "<a few words>"}, ' +
            'or {"shot": null} to stay.',
          ].join('\n'),
        },
        ...seen.map(({ image }) => ({
          type: 'image_url',
          image_url: { url: image },
        })),
      ],
    }],
  },
})

/** The shot a model's answer names, with why, when it is a change: null for
 * no answer, an unknown shot, or the shot already on air. */
export let proposal = (text, shots, lit) => {
  let json = String(text ?? '').match(/\{[\s\S]*\}/)?.[0]
  let said
  try {
    said = JSON.parse(json ?? 'null')
  } catch {
    return null
  }
  let name = String(said?.shot ?? '').toLowerCase()
  let shot = shots.find((s) => s.doc?.title?.toLowerCase() == name)
  if (!shot || shot.entity.eid == lit) return null
  return { shot: shot.entity.eid, why: String(said.why ?? '').slice(0, 200) }
}

/** One look: stills of the shots' scenes, what was said, and the model's
 * answer, written as a suggested cue when it names a change that is not
 * already suggested. `see(request)` is the model call; it answers
 * `{response, usage}`. Answers what the look cost and what it suggested. */
export let look = async (
  { obs, see, apply, shots, lit, turns, suggested, now },
) => {
  let seen = await stills(obs, scenesOf(shots))
  let answer = await see(ask({ shots, lit, said: recent(turns, now), seen }))
  let next = proposal(answer.response, shots, lit)
  let open = suggested.some((c) => idOf(c.cue.shot) == next?.shot)
  if (next && !open) {
    await apply({
      entity: { eid: '$cue' },
      cue: { shot: next.shot },
      suggested: { why: next.why },
    })
  }
  return { usage: answer.usage ?? null, next: open ? null : next }
}
