/**
 * The `yak` command line, as a library.
 *
 * The command itself is the other export — `deno install -gAf jsr:@yaks/cli/yak`
 * — and this module is what it is assembled from, for anybody building the same
 * thing: the tools of the graph a config file names, or the ones an MCP server
 * lists, read at run time, every tool a subcommand, and the command line parsed
 * through each tool's own input schema.
 *
 * ```ts
 * import { argsFor, doorUrl, rpc } from '@yaks/cli'
 *
 * let ask = rpc({ url: doorUrl('yaks.app'), token: '…' })
 * let { tools } = await ask('tools/list') as { tools: [] }
 * ```
 *
 * A program with subcommands of its own passes them in and runs the same
 * program:
 *
 * ```ts
 * import { main } from '@yaks/cli/yak'
 *
 * Deno.exit(await main(Deno.args, mine))
 * ```
 *
 * A program that is not `yak` at all calls `cli(commands, opts)` — its
 * subcommands, and the name it goes by.
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
  commandOf,
  type Listed,
  type Prop,
  type Schema,
  titleOf,
  typeOf,
} from './tool.ts'
export {
  aimed,
  cli,
  type Command,
  commandFor,
  type Ctx,
  globals,
  helpTool,
  type Opts,
  unique,
  usage,
} from './run.ts'
export { type Config, configPath, PORT, read } from './config.ts'
export { listed, printed, rosterOf } from './platform.ts'
export { appStray, appTools } from './commands.ts'
export { HOST, main, own, TOOLS, YAK } from './yak.ts'
