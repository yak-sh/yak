// The rolling-deploy sync wire: old clients receive bare Change[] batches;
// clients that advertise cursor envelopes receive {live, cursor}. New
// decoders accept both until every long-lived client speaks the capability.
import type { Change, Live } from './types.ts'

export let liveFrame = (
  changes: Change[],
  cursor: number,
  envelope: boolean,
): Change[] | Live => envelope ? { live: changes, cursor } : changes

export let liveChanges = (frame: unknown): Change[] | undefined =>
  Array.isArray(frame)
    ? frame as Change[]
    : frame && typeof frame == 'object' &&
        Array.isArray((frame as Partial<Live>).live)
    ? (frame as Live).live
    : undefined
