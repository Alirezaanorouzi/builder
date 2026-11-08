/**
 * Smoke test for parsePromptImagesFromClient — run: npx tsx scripts/verify-prompt-images.ts
 */
import { parsePromptImagesFromClient } from "../src/lib/prompt-images";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

try {
  assert(parsePromptImagesFromClient(null).length === 0, "null → []");
  assert(parsePromptImagesFromClient([]).length === 0, "[] → []");
  const one = parsePromptImagesFromClient([
    { data: tinyPngBase64, mimeType: "image/png", width: 1, height: 1 },
  ]);
  assert(one.length === 1 && one[0]!.mimeType === "image/png", "single png");
  assert(one[0]!.dimension?.width === 1, "dimension width");
  let rejected = false;
  try {
    parsePromptImagesFromClient([{ data: tinyPngBase64, mimeType: "image/bmp" }]);
  } catch {
    rejected = true;
  }
  assert(rejected, "bmp rejected");
  console.log("OK: verify-prompt-images passed");
} catch (e) {
  console.error(e);
  process.exit(1);
}
