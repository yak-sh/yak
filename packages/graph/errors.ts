/** A refused graph operation: its message says what prevented it. */
export class Refused extends Error {
  /** @param message what prevented the requested operation */
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}
