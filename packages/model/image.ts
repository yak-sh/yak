/**
 * An image made from a prompt, as a tool a model calls: `image_new`,
 * declared for the image models a host offers, and asked of one of them with
 * the prompt alone and no tools. The model's reply carries the image as an
 * artifact, kept wherever the host's provider keeps generated media
 * (`Reply.artifacts`). What a host adds is its own: how the call is paid
 * for, where the bytes go, and what the caller is told of them.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { imageMade, imageTool } from '@yaks/model/image'
 *
 * let tool = imageTool(['sketch', 'paint'])
 * equal(tool.name, 'image_new')
 * let asked: unknown[] = []
 * let made = await imageMade(
 *   (req) => {
 *     asked.push([req.model, req.items, req.input])
 *     return Promise.resolve({ id: 'r', model: req.model, items: [] })
 *   },
 *   ['sketch', 'paint'],
 *   { prompt: 'A yak', size: '1024x1024' },
 * )
 * equal(made.model, 'sketch')
 * equal(asked, [[
 *   'sketch',
 *   [{ kind: 'user', text: 'A yak' }],
 *   { size: '1024x1024' },
 * ]])
 * ```
 *
 * @module
 */
import { type Model, ModelError, type Reply, type Tool } from './mod.ts'

/** What a host says of `image_new` beside the words it has of its own:
 * where the image goes (`about`), and how to choose among its models
 * (`choosing`). */
export type ImageWords = { about?: string; choosing?: string }

/** The tool a model makes an image with, for `models`, the first made with
 * unless another is asked for. */
export let imageTool = (
  models: string[],
  { about = '', choosing = '' }: ImageWords = {},
): Tool => ({
  name: 'image_new',
  description: ['Make an image from a prompt.', about].filter(Boolean)
    .join(' '),
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What the image shows, in words.',
      },
      model: {
        type: 'string',
        enum: models,
        description: [
          `The model to make it with: ${models[0]} unless asked for another.`,
          choosing,
        ].filter(Boolean).join(' '),
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
})

/** The image `args` (`image_new`'s) asks for, made by `make`: the prompt
 * alone, no tools, every other setting as the request's `input`. A missing
 * prompt or a model not among `models` is a `ModelError` coded `input`, for
 * the caller to correct, and nothing is asked. */
export let imageMade = (
  make: Model,
  models: string[],
  args: Record<string, unknown>,
): Promise<Reply> => {
  let { prompt, model = models[0], ...input } = args
  let text = typeof prompt == 'string' ? prompt.trim() : ''
  if (!text) {
    return Promise.reject(new ModelError('input', 'say what the image shows'))
  }
  if (!models.includes(String(model))) {
    return Promise.reject(
      new ModelError('input', `make it with one of ${models}`),
    )
  }
  return make({
    model: String(model),
    items: [{ kind: 'user', text }],
    tools: [],
    input,
  })
}
