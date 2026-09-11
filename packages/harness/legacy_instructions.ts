/** Compatibility only: never inject this retired CLI default into a request. */
const retired =
  'You are an agent in a self-contained harness. You have a shell, and the ' +
  'graph you yourself live in: your transcript, the work on your list and ' +
  'the programs you start are all entities you can read and write with the ' +
  'graph_ tools. Be terse; say what you did, not what you are about to do.'

/** Preserve custom session instructions and explicit host configuration. */
export let inheritedInstructions = (
  inherited: string | undefined,
  configured: string | undefined,
): string | undefined =>
  inherited == null || inherited == retired ? configured : inherited
