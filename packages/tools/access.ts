// A declared command's caller floor, shared by the app page and its server.
export type Floor = 'person' | 'editor' | 'owner'

export let mayCall = (
  floor: Floor | undefined,
  person: string | null,
  role: string | null,
) =>
  !floor ||
  !!person && (floor == 'person' ||
      role == 'owner' || floor == 'editor' && role == 'editor')
