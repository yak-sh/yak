import { BRANDS, POSES } from './parts.ts'

export const homeStyle: URL = new URL('./style.css', import.meta.url)
export const homeScript: URL = new URL('./story.js', import.meta.url)
export const skyScript: URL = new URL('./sky.js', import.meta.url)

export const homeFigures: { name: string; file: URL }[] = [
  ...POSES.map((name) => ({
    name: `home-mascot/${name}.webp`,
    file: new URL(`./mascot/${name}.webp`, import.meta.url),
  })),
  ...BRANDS.map((name) => ({
    name: `home-brands/${name}.svg`,
    file: new URL(`./brands/${name}.svg`, import.meta.url),
  })),
]
