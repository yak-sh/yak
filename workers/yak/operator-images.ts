// The Operator's own pictures: one made on a model config.ts `images` names,
// through the same door an app's store asks for generated media (@yaks/openai
// generations.ts, lent here as providers.ts lends the platform's), charged to
// the space's budget like any model call (meter.ts `accounted`). The image is
// kept as an Operator file in the space's files (operator-channels.ts
// `keepFile`), so it is shown to the person and to the model beside the step
// that made it, and library_add puts it in an app. No app is made to hold it.
import { ModelError } from '@yaks/model'
import type { Tool } from '@yaks/session'
import { CallError } from '@yaks/tools/errors'
import { images, providing } from './config.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { accounted } from './meter.ts'
import { attachmentId, type File, keepFile } from './operator-channels.ts'
import { platform, served } from './providers.ts'
import { refuse } from './tool.ts'
import { mediaRoom } from './usage.ts'

// What a model refuses that the Operator can correct, or the space's budget
// or files can't hold: said back to it as a refusal. Anything else is a fault.
let THEIRS = ['bad_request', 'input', 'limit', 'space_full']

let EXT: Record<string, string> = { jpeg: 'jpg' }

/** The tool a space's Operator makes an image with. */
export let imageNew = (env: Env, space: Space): Tool => ({
  name: 'image_new',
  title: 'Make an image',
  step: { doing: 'Making an image…', done: 'Made an image' },
  description:
    "Make an image from a prompt. It is kept in the space's files, shown to the person in the conversation and to you beside the result, and paid from the space's budget. Use this when someone asks for a picture; make an app only when they want one. library_add with the attachment id it gives puts the image in an app.",
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What the image shows, in words.',
      },
      model: {
        type: 'string',
        enum: images.models,
        description: `The model to make it with: ${
          images.models[0]
        } unless asked for another. A sunburst model is for detailed work, a flare model for fast iteration.`,
      },
      size: {
        type: 'string',
        description:
          'auto, or WIDTHxHEIGHT with both edges multiples of 16 (1024x1024).',
      },
      quality: {
        type: 'string',
        enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
        description:
          'Higher costs more; low is enough for a draft. auto is the most expensive to hold for.',
      },
      background: { type: 'string', enum: ['auto', 'opaque', 'transparent'] },
      output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
    },
    required: ['prompt'],
  },
  run: async (args) => {
    let { prompt, model = images.models[0], ...input } = args as Record<
      string,
      unknown
    >
    let text = typeof prompt == 'string' ? prompt.trim() : ''
    if (!text) throw refuse('arguments', 'say what the image shows')
    if (!images.models.includes(String(model))) {
      throw refuse('arguments', `make it with one of ${images.models}`)
    }
    let kept = new Map<string, File>()
    let make = accounted(
      env,
      (dir) => dir.at(space.eid),
      served(env, () => ({
        ...platform(env),
        store: Object.assign(async (bytes: Uint8Array, mime: string) => {
          let ext = mime.split('/')[1]
          let file = await keepFile(
            env,
            space,
            `image.${EXT[ext] ?? ext}`,
            mime,
            new Uint8Array(bytes),
          ).catch((e) => {
            // Filled since room was asked: said to the model as it was.
            if (e instanceof CallError) throw new ModelError(e.code, e.message)
            throw e
          })
          kept.set(attachmentId(file), file)
          return {
            address: attachmentId(file),
            media_type: mime,
            size: bytes.byteLength,
          }
        }, { room: mediaRoom(env, space) }),
      }), providing)[images.provider],
      undefined,
      undefined,
      images.provider,
    )
    let reply = await make({
      model: String(model),
      items: [{ kind: 'user', text }],
      tools: [],
      input,
    }).catch((e) => {
      if (e instanceof ModelError && THEIRS.includes(e.code)) {
        throw refuse(e.code, e.message)
      }
      throw e
    })
    let files = (reply.artifacts ?? []).map((a) => kept.get(a.address)!)
    let cost = reply.cost == null ? '' : ` for $${reply.cost.toFixed(4)}`
    return {
      text: `Made the image${cost} with ${model}, attachment ${
        files.map(attachmentId).join(', ')
      }. It is shown to the person in the conversation, and to you beside this.`,
      with: { operator_files: { files } },
    }
  },
})
