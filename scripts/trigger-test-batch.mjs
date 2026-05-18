// Trigger bulk import + LLM rewrite for 30 Japan test tours
// Run on Fly: cd /app && pnpm dlx tsx scripts/trigger-test-batch.mjs
// Or: cd /app && ./node_modules/.bin/tsx scripts/trigger-test-batch.mjs
import { bulkImportFromLion, queueRewriteForImportedTours } from "../server/services/lionBulkImportService.ts";

const ids = [
  "d138af5f-1ab3-48c7-9599-b2974cb89d75",
  "42c85a7a-17ac-4046-9abb-6490dc897593",
  "ec506e9c-48f8-4463-84e4-66fc556a0ec9",
  "ac026b10-4539-4079-bdba-01b674093608",
  "1ca3ebb9-3a8c-4bc6-b006-01bd96aa5156",
  "ec273c17-b577-40f6-a045-0e7892343a92",
  "a34f11ac-58f3-44a0-8703-66cac9daf2c9",
  "22fca136-ecbb-438f-8404-25809102dece",
  "4f592834-4b8a-448a-9393-4bca9874b06d",
  "6b836e49-ac49-44c0-b651-f9443db8c837",
  "3bb17e1f-9914-4527-9445-46ce9ba5028a",
  "d307c117-f7f4-4e83-9c33-30efa00a45c4",
  "92acc5da-b309-4ef2-9b0c-5c2973db62bf",
  "c81a0b04-803c-44af-89de-168fc469ddf0",
  "e9ab0434-1786-4f45-b77a-73a0c9ab0583",
  "22cbf9ae-7073-4484-bfde-24b8cdd212cb",
  "3e23bc3b-1231-4279-8669-f312424bfc79",
  "27b9a387-5840-4062-bdca-8970e2ceaaf1",
  "824828e2-21aa-4aa8-933d-57ecafd7489e",
  "f8798ecb-80fa-4d8f-a24b-a05f797fdc58",
  "97d47e13-2e61-43d5-9878-40223a8952ba",
  "e994a98c-6d41-4f35-a069-ef1725b9971c",
  "b59c83c5-ac20-46a6-9a74-82ead7b5cfb0",
  "58dc1a40-4cb4-444d-878e-69a081652b9e",
  "797c26f2-99ea-493a-acfb-102f179b871e",
  "856e15e7-9093-4736-b2ca-25fb36de4b74",
  "5bc4188d-ce80-4772-9ab8-8262c92626c4",
  "8c77783c-b6a4-468e-bc53-3798f19b23ad",
  "bfac238c-f5c7-4dab-9fbc-dd163b684520",
  "b146ace2-6a19-469a-a871-a8990d578c63",
];

console.log(`Starting bulk import for ${ids.length} Lion tours...`);
const t0 = Date.now();
const result = await bulkImportFromLion({ ids, userId: 1 });
console.log(`Import done in ${Math.round((Date.now() - t0) / 1000)}s: ${result.imported}/${result.total} imported, ${result.failed} failed`);

const tourIds = result.results.filter(r => r.success && r.tourId).map(r => r.tourId);
console.log(`\nQueueing LLM rewrite for ${tourIds.length} draft tours...`);
const rewriteResult = await queueRewriteForImportedTours(tourIds, { userId: 1 });
console.log(`Queued: ${rewriteResult.queued} jobs`);

console.log(`\nTour IDs: ${tourIds.join(", ")}`);
process.exit(0);
