/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { waitLog, watchWait } from './stall_wait.ts'

let stop: (() => void) | undefined
self.onmessage = (
  { data }: MessageEvent<{ place: string; buffer: SharedArrayBuffer }>,
) => {
  stop?.()
  stop = watchWait(data.place, waitLog(data.buffer))
}
