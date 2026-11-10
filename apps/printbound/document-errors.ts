/** A supplied document or artwork needs correction before printing. */
export class DocumentInputError extends Error {}

/** Wrap parsing and validation of supplied bytes, never their transport. */
export let supplied = async <T>(parse: () => T | Promise<T>): Promise<T> => {
  try {
    return await parse()
  } catch (error) {
    if (error instanceof DocumentInputError) throw error
    throw new DocumentInputError(
      error instanceof Error ? error.message : String(error),
    )
  }
}
