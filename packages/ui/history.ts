// A history port is the platform primitive beneath a controlled page stack.
// Its path names the top page; state holds whatever the app restores with it.
export type HistoryEntry = { path: string; state: unknown }
export interface HistoryPort {
  read(): HistoryEntry
  write(entry: HistoryEntry, replace?: boolean): void
  listen(fn: (entry: HistoryEntry) => void): () => void
  back(): void
  forward(): void
}
let port: HistoryPort | undefined
/** A door installs its history before mounting an app. */
export let installHistory = (history: HistoryPort): void => {
  port = history
}
export let historyPort = (): HistoryPort | undefined => port
