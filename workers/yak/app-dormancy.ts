// Dormancy belongs to the storage, outside the app's rows. Every host uses
// the same persisted marks before stopping or restarting its runtime duties.
type Storage = {
  put?(key: string, value: unknown): Promise<void>
  deleteAlarm?(): Promise<void>
}
type Page = { close?(code: number, reason: string): void }

/** Stop ordinary wakes and close the pages; keep every saved row. */
export let suspendStore = async (storage: Storage, pages: Iterable<Page>) => {
  await storage.put?.('moving', false)
  await storage.put?.('dormant', true)
  await storage.deleteAlarm?.()
  for (let page of pages) {
    try {
      page.close?.(1000, 'trashed')
    } catch { /* already gone */ }
  }
}

/** Finish the active host before arming the first ordinary wake again. */
export let reviveStore = async (storage: Storage, host: {
  activate: () => void
  start: () => Response | undefined | Promise<Response | undefined>
  arm: () => Promise<unknown>
}) => {
  await storage.put?.('dormant', false)
  host.activate()
  await storage.put?.('moving', false)
  let no = await host.start()
  if (no) return no
  await host.arm()
  return Response.json({ ok: true })
}
