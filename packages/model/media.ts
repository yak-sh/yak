// A generated-media receipt survives delivery failure. Hosts keep these records
// in private storage: provider responses can contain temporary URL credentials.
import { ModelError, type Reply, type Request } from './mod.ts'
import { addressOf, type Blobs, decode, encode, keep } from '@yaks/blob'

/** Private delivery metadata, attributed to the original model request. */
export type MediaReceipt = {
  call: string
  id: string
  model: string
  /** The adapter that owns delivery; absent on legacy Workers AI receipts. */
  provider?: string
  input: unknown
  response: unknown
  /** False retains partial output without authorizing delivery. */
  complete?: boolean
  cost?: number
  costReported?: boolean
  reply?: Reply
}

/** The host's durable private store; never a transcript or a public blob. */
export type MediaReceipts = {
  read: (call: string) => Promise<MediaReceipt | undefined>
  save: (receipt: MediaReceipt) => Promise<void>
}

/** A private receipt pointer, or an inline receipt written by an older host. */
export type MediaRecord = Partial<MediaReceipt> & { payload?: string }

/** Checkpoint before any download, storage, cancellation or delivery work. */
export let receivedMedia = async (
  req: Request,
  receipt: MediaReceipt,
  store?: MediaReceipts,
): Promise<void> => {
  await store?.save(receipt)
  await req.onReceipt?.(receipt)
  if (receipt.complete !== false) await req.onMedia?.(receipt)
}

/** Delivery only. There is deliberately no generation callback at this door. */
export let recoveredMedia = async (
  call: string,
  store: MediaReceipts | undefined,
  deliver: (receipt: MediaReceipt) => Promise<Reply>,
): Promise<Reply> => {
  let receipt = await store?.read(call)
  if (!receipt) {
    throw new ModelError(
      'media_missing',
      'No private media receipt for this call',
    )
  }
  if (receipt.complete === false) {
    throw new ModelError(
      'media_incomplete',
      'Private media receipt is incomplete',
    )
  }
  if (receipt.reply) return receipt.reply
  let reply = await deliver(receipt)
  await store!.save({ ...receipt, reply })
  return reply
}

/** Adapt the existing private-record interface without knowing its storage. */
export let mediaReceipts = (
  records: {
    read: (call: string) => Promise<MediaRecord | undefined>
    update: <T>(
      call: string,
      fn: (record: MediaRecord) => Promise<T>,
    ) => Promise<T>
  },
  blobs?: Blobs,
): MediaReceipts => {
  let read = async (call: string): Promise<MediaReceipt | undefined> => {
    let record = await records.read(call)
    if (record?.call != call || !record.id || !record.model) return
    if (record.payload === undefined) return record as MediaReceipt
    let bytes = await blobs?.get(record.payload)
    if (!bytes || await addressOf(bytes) != record.payload) {
      throw new ModelError(
        'media_receipt',
        'Private media receipt payload is missing or corrupt',
      )
    }
    let receipt = JSON.parse(decode(bytes)) as MediaReceipt
    if (
      receipt.call != call || receipt.id != record.id ||
      receipt.model != record.model
    ) {
      throw new ModelError(
        'media_receipt',
        'Private media receipt payload does not match its record',
      )
    }
    return receipt
  }
  return {
    read,
    save: async (receipt) => {
      let value = JSON.stringify(receipt)
      let stored: MediaRecord = { ...receipt }
      if (blobs) {
        let bytes = encode(value)
        let payload = await addressOf(bytes)
        await keep(blobs, payload, bytes)
        stored = {
          call: receipt.call,
          id: receipt.id,
          model: receipt.model,
          payload,
        }
      }
      await records.update(receipt.call, (record) => {
        if (record.id && record.id != receipt.id) {
          throw new ModelError(
            'media_receipt',
            'This call already has a recording',
          )
        }
        for (let key of Object.keys(record)) {
          delete record[key as keyof MediaRecord]
        }
        Object.assign(record, stored)
        return Promise.resolve()
      })
      let saved = await read(receipt.call)
      if (JSON.stringify(saved) != value) {
        throw new ModelError(
          'media_receipt',
          'Private media receipt was not saved',
        )
      }
    },
  }
}
