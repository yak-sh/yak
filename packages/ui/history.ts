// A history port is the platform primitive beneath a controlled page stack.
// Its path names the top page; state holds whatever the app restores with it.
import type { HistoryPort } from '@yaks/tui/history'
export type { HistoryEntry, HistoryPort } from '@yaks/tui/history'
let port: HistoryPort | undefined
/** A door installs its history before mounting an app. */
export let installHistory = (history: HistoryPort): void => {
  port = history
}
export let historyPort = (): HistoryPort | undefined => port
