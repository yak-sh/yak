// Private normalized output survives artifact delivery and metadata failures.
import {
  type MediaReceipt,
  type MediaReceipts,
  ModelError,
  type Reply,
} from '@yaks/model'
import { generatedMedia } from '@yaks/openai'
import type { MediaOptions } from './chat.ts'
import { generationCost } from './cost.ts'

export type Output = {
  kind: 'chat' | 'speech'
  reply: Reply
  audio: string
  mediaType: string
  images: { data: string; mediaType: string }[]
  lookupCost: boolean
}
export type Delivery = {
  key: () => string | Promise<string>
  fetch?: typeof fetch
  signal?: AbortSignal
  media?: MediaOptions
  receipts?: MediaReceipts
}

/** No provider submission: only private bytes, artifact storage and cost reads. */
export let deliver = async (
  receipt: MediaReceipt,
  options: Delivery,
): Promise<Reply> => {
  let output = receipt.response as Output
  if (output?.kind != 'chat' && output?.kind != 'speech') {
    throw new ModelError('media_response', 'Unknown OpenRouter private receipt')
  }
  let reply = { ...output.reply }
  let artifacts: NonNullable<Reply['artifacts']> = []
  if (output.audio || output.kind == 'speech') {
    artifacts.push(
      await generatedMedia(
        output.audio,
        output.mediaType,
        receipt.id + (output.kind == 'chat' ? ':audio' : ''),
        options.media,
      ),
    )
  }
  for (let [index, image] of output.images.entries()) {
    artifacts.push(
      await generatedMedia(
        image.data,
        image.mediaType,
        receipt.id + ':image:' + index,
        options.media,
      ),
    )
  }
  if (artifacts.length) reply.artifacts = artifacts
  if (output.lookupCost && receipt.cost == null) {
    let cost = await generationCost(receipt.id, options)
    Object.assign(receipt, { cost, costReported: true })
    await options.receipts?.save(receipt)
  }
  if (receipt.cost != null) reply.cost = receipt.cost
  return reply
}
