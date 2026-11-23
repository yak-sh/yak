// The Operator's voices: ElevenLabs (@yaks/speech's `ELEVENLABS`) speaking a
// line in any voice the account has, listing those voices, and designing or
// cloning new ones, for voice auditions and voiced lines. It asks with the
// person's own ElevenLabs connection (speech.ts `ownKey`), whose account pays,
// else with the platform's key, charged to the space's budget (`speaking`);
// designing and adding voices take their own connection only (`making`).
//
// What it makes is kept as Operator files in the space's files
// (operator-channels.ts `keepFile`) and attached beside the call that made
// them (`madeFiles`), as an image made is (operator-images.ts): shown to the
// person, listed among their files, and put in an app by library_add.
import { ModelError } from '@yaks/model'
import {
  clone,
  design,
  ELEVENLABS,
  keep,
  SpeechError,
  voices,
} from '@yaks/speech'
import type { Tool } from '@yaks/session'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { attachmentBytes } from './attachments.ts'
import { keepFile, madeFiles } from './operator-channels.ts'
import { attachmentId, type File } from './operator-files.ts'
import type { OperatorStore } from './operator-store.ts'
import { making, ownKey, speaking, voicing } from './speech.ts'
import { type Ctx, refuse } from './tool.ts'

// Spoken at once: about two minutes of speech.
let MAX_TEXT = 2000

let CONNECT =
  'Speaking through ElevenLabs needs its key: the person connects their own ElevenLabs account at their space’s connections.'

/** The voice tools a member's Operator holds, asked for `ctx.person`. */
export let voiceTools = (
  env: Env,
  ctx: Pick<Ctx, 'person' | 'dir'>,
  space: Space,
  store: Pick<OperatorStore, 'g'>,
): Tool[] => {
  // ElevenLabs with the person's own key, else the platform's, or refused.
  let on = async () => {
    let got = voicing(
      env,
      ELEVENLABS,
      await ownKey(env, ctx, space, ELEVENLABS),
    )
    if (!got) throw refuse('connection', CONNECT)
    return got
  }
  // What ElevenLabs or the space's budget refuses that the Operator can act
  // on, said back to it; anything else is a fault.
  let told = async <T>(work: () => Promise<T>) => {
    try {
      return await work()
    } catch (e) {
      if (e instanceof ModelError) throw refuse(e.code, e.message)
      if (e instanceof SpeechError && !e.retry) {
        throw refuse('elevenlabs', e.message)
      }
      throw e
    }
  }
  let kept = (name: string, mime: string, bytes: Uint8Array) =>
    keepFile(env, space, name, mime, new Uint8Array(bytes))

  return [
    {
      name: 'voice_list',
      title: 'List voices',
      step: { doing: 'Listing voices…', done: 'Listed voices' },
      description:
        'List the ElevenLabs voices you can speak a line in with speech_new: the premade ones, and those the person designed, cloned or added on their own ElevenLabs account. Each is its id, name, how it sounds, and a sample to play. Without their own account connected, only the premade ones, charged to the space.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description:
              'Words a voice’s name or description has; omit for all.',
          },
        },
      },
      run: async (args) => {
        let all = await told(async () => voices(await on()))
        let words = String(args.search ?? '').toLowerCase().trim()
        return JSON.stringify(
          words
            ? all.filter((v) =>
              `${v.name} ${v.about}`.toLowerCase().includes(words)
            )
            : all,
        )
      },
    },
    {
      name: 'speech_new',
      title: 'Voice a line',
      step: { doing: 'Voicing a line…', done: 'Voiced a line' },
      description:
        "Speak a line in an ElevenLabs voice (voice_list gives their ids) as an MP3, kept in the space's files and shown to the person beside this. Use it for voice auditions, narration and characters' lines: one call a line. With the person's own ElevenLabs account it is charged there; else to the space's budget. library_add with the attachment id it gives puts the audio in an app.",
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: `The words to say, up to ${MAX_TEXT} characters.`,
          },
          voice: {
            type: 'string',
            description:
              'The voice’s id; omit for George, a warm British storyteller.',
          },
          speed: {
            type: 'number',
            description:
              'How fast, 0.7 to 1.2 times its own pace; 1 if omitted.',
          },
        },
        required: ['text'],
      },
      run: async (args, call) => {
        let text = String(args.text ?? '').trim()
        if (!text || text.length > MAX_TEXT) {
          throw refuse('arguments', `text: say 1 to ${MAX_TEXT} characters.`)
        }
        let voice = typeof args.voice == 'string' && args.voice
          ? args.voice
          : undefined
        let file = await told(async () => {
          let { key, own } = await on()
          let said = await speaking(env, space, text, {
            provider: ELEVENLABS,
            ...own ? { key } : {},
            voice,
            ...typeof args.speed == 'number' ? { speed: args.speed } : {},
          })
          let bytes = new Uint8Array(
            await new Response(said.body).arrayBuffer(),
          )
          return await kept('line.mp3', said.type, bytes)
        })
        return madeFiles(
          store,
          call,
          `Voiced it in ${voice ?? ELEVENLABS.speak.voice}, attachment ${
            attachmentId(file)
          }. It is shown to the person beside this.`,
          [file],
        )
      },
    },
    {
      name: 'voice_design',
      title: 'Design a voice',
      step: { doing: 'Designing voices…', done: 'Designed voices' },
      description:
        "Design new ElevenLabs voices from a description of how one sounds (age, accent, timbre, character, delivery). Answers a few designs, each a sample kept in the space's files and shown to the person, and the design id voice_add keeps it by. Needs the person's own ElevenLabs account, where it is charged.",
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description:
              'How the voice sounds, 20 to 1000 characters: "an old sea captain, gravelly and warm, slow".',
          },
          text: {
            type: 'string',
            description:
              'What each sample says, 100 to 1000 characters; omit for words ElevenLabs picks.',
          },
        },
        required: ['description'],
      },
      run: async (args, call) => {
        let description = String(args.description ?? '').trim()
        if (!description) {
          throw refuse('arguments', 'description: say how it sounds.')
        }
        let files: File[] = []
        let ids = await told(async () => {
          let made = await design({
            ...making(await on()),
            description,
            ...typeof args.text == 'string' && args.text
              ? { text: args.text }
              : {},
          })
          for (let d of made) {
            files.push(await kept('design.mp3', d.type, d.audio))
          }
          return made.map((d, n) =>
            `design ${d.id} (attachment ${attachmentId(files[n])})`
          )
        })
        return madeFiles(
          store,
          call,
          `Designed ${ids.length}: ${
            ids.join('; ')
          }. Their samples are shown to the person beside this; voice_add keeps the one they pick.`,
          files,
        )
      },
    },
    {
      name: 'voice_add',
      title: 'Add a voice',
      step: { doing: 'Adding a voice…', done: 'Added a voice' },
      description:
        "Add a voice to the person's own ElevenLabs account, answering its id for speech_new: a design voice_design made, by its design id, or a clone of someone's voice from recordings of it in the space's files, by their attachment ids. Clone only a voice the person has the right to: their own, or one whose owner agreed. Cloning needs an ElevenLabs plan that allows it; ElevenLabs says so when it does not.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What the voice is called.' },
          description: {
            type: 'string',
            description: 'How it sounds, as its list shows it.',
          },
          design: {
            type: 'string',
            description: 'The design id voice_design gave, to keep it.',
          },
          recordings: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Attachment ids of recordings of the voice, to clone it: a minute or more of clear speech in all.',
          },
        },
        required: ['name'],
      },
      run: async (args) => {
        let name = String(args.name ?? '').trim()
        let description = String(args.description ?? '').trim()
        let recordings = Array.isArray(args.recordings)
          ? args.recordings.map(String)
          : []
        if (!name) throw refuse('arguments', 'name: say what it is called.')
        if (!args.design == !recordings.length) {
          throw refuse(
            'arguments',
            'Give a design to keep, or recordings to clone, not both.',
          )
        }
        let id = await told(async () => {
          let mine = making(await on())
          if (typeof args.design == 'string' && args.design) {
            return await keep({
              ...mine,
              design: args.design,
              name,
              description: description || name,
            })
          }
          let samples = await Promise.all(recordings.map(async (r) =>
            new Blob([
              await attachmentBytes(env, space, r, {
                person: ctx.person,
                role: await ctx.dir.role(space, ctx.person),
              }),
            ])
          ))
          return await clone({
            ...mine,
            name,
            samples,
            ...description ? { description } : {},
          })
        })
        return `Added ${name} to their ElevenLabs account: voice ${id}.`
      },
    },
  ]
}
