// What to call a person, apart from the sign-in that reads a typed address
// (signin.ts): the directory and every page that shows a person name them
// without loading a phone number's metadata.

// An address is not a name. A person minted before anyone was asked wears
// their address as `doc.title` (T-32627), so that title reads as no name at
// all: the next sign-in writes the front of the address in its place, and an
// app's store never learns an address (T-32654). Nothing has to be rewritten on deploy.
export let chose = (title?: string | null) =>
  title && !title.includes('@') ? title : null

// What to call someone: the name they chose, else the front of their email
// address — `dana` from `dana@example.com`. This is the only name that leaves
// the directory.
export let nameOf = (title: string | null | undefined, email: string) =>
  chose(title) ?? email.trim().toLowerCase().split('@')[0]
