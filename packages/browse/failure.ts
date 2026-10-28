// Browsers report through their page tracker; terminal commands supply their
// host's durable tracker reporter at the same catch sites.
export type Reporter = (error: unknown, place: string) => void
let reporter: Reporter | undefined

export let onFailure = (next: Reporter): () => void => {
  let prior = reporter
  reporter = next
  return () => {
    reporter = prior
  }
}

export let failure = (error: unknown, place: string): void => {
  if (reporter) reporter(error, place)
  else {
    let said = error instanceof Error ? error.message : String(error)
    console.error(`${place} could not be drawn: ${said}`, error)
  }
}
