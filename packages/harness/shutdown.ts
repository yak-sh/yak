/** Expected refusal of new frontend work after shutdown admission closes. */
export class ShuttingDown extends Error {
  constructor() {
    super('Worker is shutting down')
    this.name = 'ShuttingDown'
  }
}
