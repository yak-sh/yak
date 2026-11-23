/** A refusal of the caller's own print input, distinct from a failed provider
 * request or a programming exception that the platform must report. */
export class InputError extends Error {}

/** yaks.app refusing this caller the call out (a connection kept to members,
 * a spent cap): a no to say to the caller, not a failure to report. */
export class AccessError extends Error {}
