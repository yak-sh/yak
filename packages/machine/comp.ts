// The provider's durable record, separate from the Machine it answers.

/** The component name. */
export let MACHINE = 'machine'
/** A provider's recorded machine state. */
export type MachineState = 'requested' | 'running' | 'asleep' | 'released'
/** What the graph records about a machine. */
export type MachineRecord = {
  provider?: string
  from?: string
  image?: string
  state?: MachineState
}
