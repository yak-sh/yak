/** The names a room's page, its rules and its worker share, with no browser
 * or worker in them: `@yaks/game/room` and `@yaks/game/rooms` both export
 * them, so a rules module imported on both sides throws the one
 * {@link RoomRefused} either side catches. */

/** A browser's place in a room: the room's id and its seat's entity id. */
export type Seat = { room: string; seat: string }
/** A seat as hosting or joining answers it: `host` for the room's first
 * seat, and `invite` once the host has asked for an invitation. */
export type Joined = Seat & { host: boolean; invite?: string }

/** A refusal meant for the player: a rule declining an action, or the room
 * declining a request (no invitation, a full room, a turn that moved on). */
export class RoomRefused extends Error {}

/** The room's requests, relative to the app's address. */
export let roomPath = (room: string): string => `rooms/${room}/`

/** Whether `value` is the form of a room id or an invitation. */
export let roomId = (value: string): boolean =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)
