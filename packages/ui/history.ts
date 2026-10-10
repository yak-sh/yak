// A history port is the platform primitive beneath an app's pages.
// Its path names the page; state holds whatever the app restores with it.
import type { HistoryPort } from '@yaks/tui/history'
export type { HistoryEntry, HistoryPort } from '@yaks/tui/history'
let port: HistoryPort | undefined
/** A door installs its history before mounting an app; return the prior door
 * so a temporary host can put it back when it leaves. */
export let installHistory = (
  history?: HistoryPort,
): HistoryPort | undefined => {
  let prior = port
  port = history
  return prior
}
export let historyPort = (): HistoryPort | undefined => port
