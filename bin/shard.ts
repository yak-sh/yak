// One shard of the deno platform's test files, in one runtime.
//
// `deno test a_test.ts b_test.ts` starts a runtime for each module it is
// handed and loads that module's graph into it afresh. Most of the repo's test
// files reach the same packages, so a shard of seventy-odd files loaded them
// seventy-odd times: about twelve seconds a shard before its first test ran,
// against one for the lot. Handed this module and its files after `--`, deno
// starts one runtime, and every file's tests register in it (M-39441: a
// platform's environment starts once).
//
// A file that cannot be loaded is a failing test of its own, named for the
// file, and the other files still run.

for (let file of Deno.args) {
  try {
    await import(new URL(file, `file://${Deno.cwd()}/`).href)
  } catch (error) {
    Deno.test(`${file} loads`, () => {
      throw error
    })
  }
}
