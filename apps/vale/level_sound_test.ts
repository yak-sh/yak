// Editing a sound description rebuilds only its recording.
import { test } from "@yaks/testing";
import { assertEquals, assertNotEquals } from "@std/assert";
import { toolEid } from "@yaks/tools";
import { buildFor } from "../../packages/builders/build.ts";
import { shop } from "../../packages/builders/testing.ts";
import vale from "./vocab.json" with { type: "json" };
import sounds from "./data/sfx/03.json" with { type: "json" };
import seed from "./data/sfx/01.json" with { type: "json" };

test("a level sound edit leaves the other sound builds unchanged", async () => {
  let tool = {
    name: "level-sound-test",
    inputSchema: { type: "object" },
    run: () => [],
  };
  let { g, failed } = await shop({}, [{ $defs: { sfx: vale.$defs.sfx } }], [
    tool,
  ]);
  let definition = seed.find((row) => "builder" in row)!;
  let builder = definition.entity.eid;
  let level = sounds.find((row) => row.sfx.name == "level")!;
  let old =
    "Sound effect only: A hero gains a level: a short uplifting four-note bell flourish, clear and satisfying, about half a second. No speech, words, music, or other sounds.";
  await g.apply([
    ...sounds.map((row) => ({
      entity: { eid: row.sfx.name },
      doc: { ...row.doc, body: row == level ? old : row.doc.body },
      sfx: row.sfx,
    })),
    {
      entity: { eid: builder },
      content: definition.content,
      builder: { ...definition.builder, to: toolEid(tool.name) },
    },
  ]);
  let keys = async () =>
    Promise.all(sounds.map(async (row) => {
      let id = (await buildFor(g, builder, [row.sfx.name]))!;
      return (await g.get([id]))[0].build?.key;
    }));
  let before = await keys();
  await g.apply([{ entity: { eid: "level" }, doc: { body: level.doc.body } }]);
  let after = await keys();
  for (let [i, row] of sounds.entries()) {
    if (row == level) assertNotEquals(after[i], before[i]);
    else assertEquals(after[i], before[i]);
  }
  assertEquals(failed, []);
});
