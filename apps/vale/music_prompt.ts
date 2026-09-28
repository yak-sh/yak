// New music prompts compose a land's authored direction with one song's theme.
// Recorded music_prompts/*.json are the exact prompts used for existing blobs.
import { LEVELS } from './levels.ts'
import { DIRECTIONS } from './music_direction.ts'

let VOICES = {
  none:
    'Purely instrumental throughout: no human voice, humming, vocal pads, choir, singing, speech or chanting.',
  solo:
    'One distant solo wordless voice may carry a phrase; no choir, lyrics, chanting, speech or spoken words.',
  choir:
    'Wordless choir voices may carry the melody; no lyrics, chanting, speech or spoken words.',
}

export let musicPrompt = (land: string, song: 1 | 2) => {
  let level = LEVELS[land], dir = DIRECTIONS[land]
  if (!level || !dir) throw new Error(`No music direction for ${land}`)
  return [
    `Create a full-length fantasy game soundtrack song for ${level.name}: ${dir.setting}.`,
    `${dir.themes[song - 1]}.`,
    `Feature ${dir.instruments}, with a memorable melodic theme, natural dynamics and a satisfying ending.`,
    VOICES[dir.voice],
    `This is song ${song} of two for this land; make it distinct and complete.`,
    'Use clean, natural acoustic production without distortion, lo-fi filtering or electronic effects.',
  ].join(' ')
}
