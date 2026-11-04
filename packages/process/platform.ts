// Platform metadata without loading operating-system or terminal operations.
import process from 'node:process'

export let os = process.platform == 'win32' ? 'windows' : process.platform
export let build = {
  os,
  arch: process.arch,
  target: `${process.arch}-${process.platform}`,
}
