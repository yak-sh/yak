/** Threads serving a graph's roles, by their own connection or over a port.
 * @module
 */
export {
  type Aside,
  type Plan,
  type Thread,
  thread,
  type ThreadOpts,
} from './thread.ts'
export { type Remote, remote, serve } from './graph.ts'
export { type Roles, roles, type Service } from './roles.ts'
export type { Host, Open, Start } from './types.ts'
