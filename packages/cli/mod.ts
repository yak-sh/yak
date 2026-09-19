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
 * A box with words of its own hands them over and runs the same command:
 *
 * ```ts
 * import { main } from '@yaks/cli/yak'
 *
 * Deno.exit(await main(Deno.args, mine))
 * ```
 *
 * A command that is not `yak` at all is `cli(tools, opts)` — the tools, and
 * what the program calls itself.
 *
 * @module
 */

export {
  argsFor,
  type Grammar,
  inflate,
  pairsIn,
  type Reads,
  type Said,
  saidIn,
  Usage,
  valueOf,
} from './args.ts'
export { bundlesIn, CHUNK, chunks } from './apply.ts'
export { complete, type Lookup } from './complete.ts'
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
export { lineOf, safe, sketch, toolHelp, toolLines, wrap } from './show.ts'
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
export {
  type Listed,
  type Prop,
  type Schema,
  titleOf,
  typeOf,
  wordOf,
} from './tool.ts'
export {
  cli,
  configPath,
  type Ctx,
  globals,
  helpTool,
  type Opts,
  unique,
  usage,
  type Word,
  wordFor,
} from './run.ts'
export { listed, printed, rosterOf } from './platform.ts'
export { appStray, appTools } from './commands.ts'
export { HOST, main, own, TOOLS, YAK } from './yak.ts'
