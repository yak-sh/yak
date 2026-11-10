/** GPT Image models over the Image API: one prompt in, one stored image out.
 * Binary persistence is injected; the price is OpenAI's published tariff. */
import {
  acknowledged,
  type Affordable,
  type Listed,
  type MediaReceipt,
  type MediaReceipts,
  ModelError,
  receivedMedia,
  recoveredMedia,
  type Reply,
  type Request,
  submitted,
} from '@yaks/model'
import { mediaTypeOf, sizeOf } from '@yaks/blob'
import { CODEX, type Credential } from './credential.ts'
import { dataUrl, generatedMedia, mediaRoom, type MediaStore } from './media.ts'

// Each family's output tokens per quality at a square of 2,000,000 pixels'
// weight, and GPT Image 2.6's own scale on them: OpenAI's cost calculator
// (developers.openai.com, guides/image-generation#calculating-costs).
let STEPS = { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 }
let SCALE: Record<string, number> = { low: 4.2, medium: 3.3 }
let FAMILIES: Record<string, Record<string, number>> = {
  'gpt-image-2.5': STEPS,
  'gpt-image-2.6': STEPS,
}
// Dollars per million tokens, the same for both families (pricing page).
let PRICE = { text: 5, image: 8, output: 30 }
// The largest image either family makes: 8,294,400 pixels, square.
let LARGEST = 2880
let FORMATS = ['png', 'jpeg', 'webp']
let MAX_REFERENCE = 14 * 1024 * 1024
let OPTIONS = [
  'size',
  'quality',
  'background',
  'output_format',
  'output_compression',
  'moderation',
  'complexity',
]

let family = (model: string) =>
  Object.keys(FAMILIES).find((f) => model == f || model.startsWith(f + '-'))

/** Whether `model` is a GPT Image model this adapter prices. */
export let image = (model: string): boolean => !!family(model)

/** What OpenAI's calculator says one image of `width` by `height` at
 * `quality` makes, in output tokens. */
export let imageTokens = (
  model: string,
  width: number,
  height: number,
  quality: string,
): number => {
  let base = FAMILIES[family(model)!][quality]
  let long = Math.max(width, height), short = Math.min(width, height)
  let s = base / (long / short), whole = Math.floor(s)
  let side = s - whole == 0.5 ? whole + whole % 2 : Math.round(s)
  let tiles = width >= height ? base * side : side * base
  let tokens = Math.ceil(tiles * (2e6 + width * height) / 4e6)
  return family(model) == 'gpt-image-2.6'
    ? Math.round(tokens * (SCALE[quality] ?? 1))
    : tokens
}

let prompt = (req: Request): string => {
  let input = req.items.findLast((item) => item.kind == 'user')
  if (!input || input.kind != 'user' || !input.text.trim()) {
    throw new ModelError('input', 'Image models need a text prompt')
  }
  return input.text
}

let references = (req: Request) => {
  let images = req.items.filter((item) => item.kind == 'image')
  if (images.length > 16 || req.items.some((item) => item.kind == 'document')) {
    throw new ModelError(
      'bad_request',
      'Image models take up to 16 reference images and no documents',
    )
  }
  for (let image of images) {
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType) ||
      image.bytes.length > MAX_REFERENCE ||
      mediaTypeOf(image.bytes) != image.mediaType || !sizeOf(image.bytes)
    ) {
      throw new ModelError(
        'bad_request',
        'References must be PNG, JPEG or WebP images under 14 MiB',
      )
    }
  }
  return images
}

let imagePrompt = (req: Request, images: ReturnType<typeof references>) =>
  [
    ...images.map((item, i) => `Reference image ${i + 1}: ${item.label}`),
    prompt(req),
  ].join('\n\n')

let requestBody = (req: Request) => {
  let images = references(req)
  return {
    model: req.model,
    prompt: imagePrompt(req, images),
    n: 1,
    ...settings(req),
    ...images.length
      ? {
        images: images.map((item) => ({
          image_url: dataUrl(item),
        })),
      }
      : {},
  }
}

let settings = (req: Request): Record<string, unknown> => {
  let input = req.input ?? {}
  let extra = Object.keys(input).filter((k) => !OPTIONS.includes(k))
  if (extra.length) {
    throw new ModelError(
      'bad_request',
      `Image models take ${OPTIONS.join(', ')}; not ${extra.join(', ')}`,
    )
  }
  let format = input.output_format ?? 'png'
  if (!FORMATS.includes(String(format))) {
    throw new ModelError(
      'bad_request',
      `Image models make ${FORMATS.join(', ')} here; not ${format}`,
    )
  }
  let quality = input.quality ?? 'auto'
  if (quality != 'auto' && !(String(quality) in FAMILIES[family(req.model)!])) {
    throw new ModelError(
      'bad_request',
      `No ${quality} quality for ${req.model}`,
    )
  }
  let size = input.size ?? 'auto'
  if (size != 'auto' && !/^\d+x\d+$/.test(String(size))) {
    throw new ModelError('bad_request', 'An image size is auto or WIDTHxHEIGHT')
  }
  return { ...input, output_format: format, quality, size }
}

/** A reservation estimate: its prompt's bytes as text tokens, and twice
 * the calculator's output at its quality (at most `max`) and size (at most the
 * largest), plus a reference-input estimate at max-quality token weight. */
export let imageQuote = (
  req: Request,
  remaining: number,
): Affordable | null => {
  let sent = settings(req)
  let quality = sent.quality == 'auto' ? 'max' : String(sent.quality)
  let [width, height] = sent.size == 'auto'
    ? [LARGEST, LARGEST]
    : String(sent.size).split('x').map(Number)
  let images = references(req)
  let text = new TextEncoder().encode(imagePrompt(req, images)).length
  // There is no published input calculator for these families. Use the
  // existing max-quality token calculator as an estimate for each reference.
  // The meter settles the provider's measured usage, even above this estimate.
  let input = images.reduce((sum, item) => {
    let { w, h } = sizeOf(item.bytes)!
    return sum + imageTokens(req.model, w, h, 'max')
  }, 0)
  let dollars = (text * PRICE.text +
    2 * imageTokens(req.model, width, height, quality) * PRICE.output +
    input * PRICE.image) / 1e6
  return dollars <= remaining ? { dollars, tokens: 0 } : null
}

type Usage = {
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
  output_tokens?: number
}

/** What an Image API answer cost: its text and image input and all its
 * output, at the published rates. */
export let imageCost = (usage: Usage | undefined): number => {
  let { text_tokens = 0, image_tokens = 0 } = usage?.input_tokens_details ?? {}
  let output = usage?.output_tokens
  if (
    ![text_tokens, image_tokens, output].every((n) =>
      Number.isSafeInteger(n) && n! >= 0
    )
  ) {
    throw new ModelError('media_cost', 'The image answer reported no usage')
  }
  return (text_tokens * PRICE.text + image_tokens * PRICE.image +
    output! * PRICE.output) / 1e6
}

/** How an image model is listed: image out, at its image rates. */
export let imageListed = (name: string): Listed => ({
  name,
  label: name,
  modalities: ['image'],
  price: { input: PRICE.image, output: PRICE.output },
})

export type Generations = {
  credential: () => Promise<Credential>
  headers?: Record<string, string>
  fetch?: typeof fetch
  media?: MediaStore
  receipts?: MediaReceipts
}

type Answer = {
  data?: { b64_json?: unknown }[]
  output_format?: string
  usage?: Usage
}

let deliver = async (
  receipt: MediaReceipt,
  media?: MediaStore,
): Promise<Reply> => {
  let answer = receipt.response as Answer
  let format = answer.output_format ?? 'png'
  if (!FORMATS.includes(format)) {
    throw new ModelError('image_format', 'Unsupported image format')
  }
  let artifact = await generatedMedia(
    answer.data?.[0]?.b64_json,
    'image/' + format,
    receipt.id,
    media,
  )
  return {
    id: receipt.id,
    model: receipt.model,
    items: [],
    artifacts: [artifact],
    cost: receipt.cost!,
    costReported: false,
  }
}

/** The Image API as a model: the newest user text is the prompt, image items
 * its references, and `req.input` its settings. The answer is kept as a private
 * receipt before its bytes are stored, so a stored image is never bought twice. */
export let generations = (options: Generations) => {
  let ask = async (req: Request): Promise<Reply> => {
    if (!options.media) {
      throw new ModelError(
        'media_storage',
        'Image output requires artifact storage',
      )
    }
    if (req.questions) {
      throw new ModelError(
        'questions',
        'Image models answer no typed questions',
      )
    }
    let body = requestBody(req)
    let credential = await options.credential()
    if (credential.base == CODEX) {
      throw new ModelError('model', 'Image models need an OpenAI API key')
    }
    await mediaRoom(options.media)
    await submitted(req)
    let res: Response
    try {
      res = await (options.fetch ?? fetch)(
        credential.base +
          (body.images ? '/images/edits' : '/images/generations'),
        {
          method: 'POST',
          headers: {
            ...options.headers,
            ...credential.token
              ? { authorization: 'Bearer ' + credential.token }
              : {},
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: req.signal,
        },
      )
    } catch (error) {
      if (req.signal?.aborted) throw error
      throw new ModelError('transport', 'OpenAI image connection failed')
    }
    if (!res.ok) {
      let code = await res.json().then(
        (b) => (b as { error?: { code?: string } })?.error?.code,
        () => undefined,
      )
      throw new ModelError(
        res.status == 400 ? 'bad_request' : 'http_' + res.status,
        `OpenAI refused the image (${res.status}${code ? ', ' + code : ''})`,
        res.status == 429 || res.status >= 500 ? { after: 0 } : undefined,
      )
    }
    let answer = await res.json() as Answer
    let id = req.call ?? crypto.randomUUID()
    await acknowledged(req, { openai: { response_id: id } })
    let receipt: MediaReceipt = {
      provider: 'openai',
      call: id,
      id,
      model: req.model,
      input: body,
      response: answer,
      cost: imageCost(answer.usage),
      costReported: false,
    }
    await receivedMedia(req, receipt, options.receipts)
    let reply = await deliver(receipt, options.media)
    await options.receipts?.save({ ...receipt, reply })
    return reply
  }
  return Object.assign(ask, {
    recover: (call: string) =>
      recoveredMedia(
        call,
        options.receipts,
        (receipt) => deliver(receipt, options.media),
      ),
  })
}
