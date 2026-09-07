/**
 * The `yak` command, and the seams it is made of.
 *
 * The command itself is the other export — `deno install -gAf jsr:@yaks/cli/yak`
 * — and this one is what it is built from, for anybody wrapping the same idea:
 * an MCP server's `tools/list` read at run time, every tool a subcommand, and
 * a command line mapped through each tool's own input schema.
 *
 * ```ts
 * import { argsFor, doorUrl, rpc } from '@yaks/cli'
 *
 * let ask = rpc({ url: doorUrl('yaks.app'), token: '…' })
 * let { tools } = await ask('tools/list') as { tools: [] }
 * ```
 *
 * A box with verbs of its own adds a PLUGIN and runs the same command:
 *
 * ```ts
 * import { main, PLUGINS } from '@yaks/cli/yak'
 *
 * Deno.exit(await main(Deno.args, [mine, ...PLUGINS]))
 * ```
 *
 * @module
 */

export {
  argsFor,
  inflate,
  pairsIn,
  type Reads,
  type Said,
  saidIn,
  Usage,
  valueOf,
} from './args.ts'
export { bundlesIn, CHUNK, chunks } from './apply.ts'
export {
  type Door,
  doorUrl,
  initialize,
  PROTOCOL,
  Refused,
  type Rpc,
  rpc,
  Unauthorized,
} from './rpc.ts'
export { type Result, rosterAfter, saidBy, STALE, versionIn } from './roster.ts'
export { safe, toolHelp, toolLines, wrap } from './show.ts'
export {
  cached,
  configDir,
  forget,
  forgetToken,
  remember,
  type Roster,
  saveToken,
  stateDir,
  tokenFor,
} from './store.ts'
export { type Prop, type Schema, titleOf, type Tool, typeOf } from './tool.ts'
export {
  type Ctx,
  helpFor,
  lineOf,
  type Part,
  parts,
  type Plugin,
  usage,
  type Verb,
  verbFor,
} from './plugin.ts'
export { platform, printed, rosterOf } from './platform.ts'
export { commands } from './commands.ts'
export { built, globals, HOST, main, PLUGINS, run } from './yak.ts'
