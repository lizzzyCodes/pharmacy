// Rebuild output/medicines.json from cache/ — no browser, no network.
// Usage: npm run build   (package.json: "build": "tsx src/parse/index.ts")
import { buildBundle } from "./buildBundle";

async function main() {
  const { bundle, failures } = await buildBundle();
  console.log(
    `Built ${Object.keys(bundle).length} medicines, ${failures.length} failed`
  );
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Bundle build failed:", err);
  process.exit(1);
});
