// A generated-media receipt survives delivery failure. Hosts keep these records
// in private storage: provider responses can contain temporary URL credentials.
import { ModelError, type Reply, type Request } from './mod.ts'

/** Private delivery metadata, attributed to the original model request. */
export type MediaReceipt = {
  call: string
  id: string
  model: string
  input: unknown
  response: unknown
  cost?: number
  costReported?: boolean
  reply?: Reply
}

/** The host's durable private store; never a transcript or a public blob. */
export type MediaReceipts = {
  read: (call: string) => Promise<MediaReceipt | undefined>
  save: (receipt: MediaReceipt) => Promise<void>
}

/** Checkpoint before any download, storage, cancellation or delivery work. */
export let receivedMedia = async (
  req: Request,
  receipt: MediaReceipt,
  store?: MediaReceipts,
): Promise<void> => {
  await store?.save(receipt)
  await req.onMedia?.(receipt)
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
  if (receipt.reply) return receipt.reply
  let reply = await deliver(receipt)
  await store!.save({ ...receipt, reply })
  return reply
}

/** Adapt the existing private-record interface without knowing its storage. */
export let mediaReceipts = (records: {
  read: (call: string) => Promise<Partial<MediaReceipt> | undefined>
  update: <T>(
    call: string,
    fn: (record: Partial<MediaReceipt>) => Promise<T>,
  ) => Promise<T>
}): MediaReceipts => ({
  read: async (call) => {
    let record = await records.read(call)
    return record?.call == call && record.id && record.model
      ? record as MediaReceipt
      : undefined
  },
  save: async (receipt) => {
    await records.update(receipt.call, (record) => {
      if (record.id && record.id != receipt.id) {
        throw new ModelError(
          'media_receipt',
          'This call already has a recording',
        )
      }
      Object.assign(record, receipt)
      return Promise.resolve()
    })
    let saved = await records.read(receipt.call)
    if (JSON.stringify(saved) != JSON.stringify(receipt)) {
      throw new ModelError(
        'media_receipt',
        'Private media receipt was not saved',
      )
    }
  },
})
