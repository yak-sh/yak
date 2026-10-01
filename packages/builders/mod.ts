/**
 * A builder defines a graph query and registered tool. Each outer binding has
 * one stable build, whose changing key opens a tool call; named outputs keep
 * their ids, keys, citations and artifact references as build history.
 *
 * @module
 */

export { builderDoc } from './vocab.ts'
export * from './key.ts'
export * from './build.ts'
export { modelTool, modelToolEid, render } from './model.ts'

export { type Supply, supply } from './supply.ts'
