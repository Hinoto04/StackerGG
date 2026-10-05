import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import sharp from "sharp";

const API_BASE = "https://stackerbattle.com/api/cards";
const IMAGE_BASE = "https://d2pib0jdcv060g.cloudfront.net/cards/face/";
const { values: options } = parseArgs({
  options: {
    output: { type: "string", default: "C:\\Hinoto\\img\\stacker" },
    prefix: { type: "string" },
    "exclude-prefix": { type: "string", multiple: true, default: [] },
    report: { type: "string", default: ".temp/stacker-image-download-report.json" },
    concurrency: { type: "string", default: "3" },
    "dry-run": { type: "boolean", default: false },
  },
});
const concurrency = Number(options.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
  throw new Error("concurrency must be an integer between 1 and 6");
}
const outputDirectory = resolve(options.output);
const reportPath = resolve(options.report);
const codePrefix = options.prefix?.replace(/[^a-z0-9]/gi, "").toUpperCase();
if (options.prefix && !codePrefix) {
  throw new Error("prefix must contain letters or digits");
}
const excludedPrefixes = options["exclude-prefix"].map((prefix) => prefix.replace(/[^a-z0-9]/gi, "").toUpperCase());
if (excludedPrefixes.some((prefix) => !prefix)) {
  throw new Error("exclude-prefix must contain letters or digits");
}
if (codePrefix && excludedPrefixes.includes(codePrefix)) {
  throw new Error("The requested prefix cannot also be excluded");
}

async function retry(task, label) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= 4 || error.permanent) {
        throw error;
      }
      console.warn(`Retry ${attempt}/3: ${label}: ${error.message}`);
      await sleep(1_000 * 2 ** (attempt - 1));
    }
  }
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${url}`);
    error.permanent = response.status >= 400 && response.status < 500 &&
      ![408, 429].includes(response.status);
    await response.body?.cancel();
    throw error;
  }
  return response;
}

async function fetchJson(url, init) {
  return retry(async () => (await request(url, init)).json(), url);
}

async function mapConcurrent(items, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

async function fetchCatalog() {
  const items = [];
  for (let offset = 0; offset < 10_000; ) {
    const payload = await fetchJson(`${API_BASE}/list/?offset=${offset}&limit=50`);
    const page = payload?.data?.data;
    if (!Array.isArray(page)) {
      throw new Error("Unexpected official card list response");
    }
    if (page.length === 0) {
      if (items.length === 0) {
        throw new Error("Official card list is empty");
      }
      return items;
    }
    items.push(...page);
    offset += page.length;
  }
  throw new Error("Official card list exceeded the pagination limit");
}

function addImage(images, cardId, rarity, sourceUrl) {
  if (!/^[A-Z0-9]+-(?:KR)?\d+$/.test(cardId) || !/^[A-Z]+$/.test(rarity)) {
    throw new Error(`Invalid card image identifier: ${cardId} ${rarity}`);
  }
  const filename = `${cardId}-${rarity}.png`;
  const url = `${IMAGE_BASE}${filename}`;
  if (sourceUrl && sourceUrl !== url) {
    throw new Error(`Unexpected official image URL for ${filename}: ${sourceUrl}`);
  }
  images.set(filename, { cardId, rarity, filename, url });
}

async function validatePng(buffer) {
  const metadata = await sharp(buffer, { failOn: "warning" }).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new Error("Not a valid PNG image");
  }
  // Decode every pixel so truncated images are not considered resumable files.
  await sharp(buffer, { failOn: "warning" }).stats();
  return {
    bytes: buffer.length,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function downloadImage(image) {
  const destination = join(outputDirectory, image.filename);
  try {
    const buffer = await readFile(destination);
    return { ...image, status: "existing", ...await validatePng(buffer) };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Existing file is unreadable or invalid; left untouched: ${destination}: ${error.message}`);
    }
  }

  const { buffer, metadata } = await retry(async () => {
    const response = await request(image.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await validatePng(buffer);
    return { buffer, metadata };
  }, image.filename);

  const temporary = `${destination}.part-${process.pid}`;
  let created = false;
  try {
    await writeFile(temporary, buffer, { flag: "wx" });
    created = true;
    await rename(temporary, destination);
  } finally {
    if (created) {
      await rm(temporary, { force: true });
    }
  }
  return { ...image, status: "downloaded", ...metadata };
}

async function main() {
  const startedAt = new Date().toISOString();
  const catalog = await fetchCatalog();
  const items = catalog.filter((item) => {
    const prefix = item.card_id?.split("-")[0];
    return (!codePrefix || prefix === codePrefix) && !excludedPrefixes.includes(prefix);
  });
  if (items.length === 0) {
    throw new Error("No official cards match the requested prefix filters");
  }
  const uniqueCards = new Map();
  const images = new Map();
  for (const item of items) {
    addImage(images, item.card_id, item.rarity, item.face_layer);
    if (!uniqueCards.has(item.card_id)) {
      uniqueCards.set(item.card_id, item);
    }
  }
  console.log(`Official list: ${items.length} entries, ${uniqueCards.size} unique cards`);

  let detailed = 0;
  const details = await mapConcurrent([...uniqueCards.values()], async (item) => {
    const payload = await fetchJson(`${API_BASE}/detail/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card_id: item.card_id, rarity: item.rarity }),
    });
    const detail = payload?.data;
    if (detail?.card_id !== item.card_id || !Array.isArray(detail.releases)) {
      throw new Error(`Unexpected official card detail: ${item.card_id}`);
    }
    addImage(images, detail.card_id, detail.rarity, detail.face_layer);
    if (detail.releases.length === 0) {
      console.warn(`No release metadata: ${item.card_id}; keeping its published image`);
    }
    for (const release of detail.releases) {
      if (!Array.isArray(release.rarities) || !release.rarities.length) {
        throw new Error(`Missing release rarities: ${item.card_id}`);
      }
      for (const rarity of release.rarities) {
        addImage(images, detail.card_id, rarity);
      }
    }
    detailed += 1;
    if (detailed % 25 === 0 || detailed === uniqueCards.size) {
      console.log(`Card details: ${detailed}/${uniqueCards.size}`);
    }
    await sleep(200);
    return detail;
  });

  const targets = [...images.values()].sort((a, b) => a.filename.localeCompare(b.filename));
  const byPrefix = {};
  for (const image of targets) {
    const prefix = image.cardId.split("-")[0];
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }
  console.log(JSON.stringify({ outputDirectory, prefix: codePrefix, excludedPrefixes, cards: uniqueCards.size, images: targets.length, byPrefix, dryRun: options["dry-run"] }, null, 2));
  if (options["dry-run"]) {
    return;
  }

  await mkdir(outputDirectory, { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  // Persist the target list before transferring, including an official source snapshot.
  const report = { source: "https://stackerbattle.com/card/", startedAt, outputDirectory, prefix: codePrefix, excludedPrefixes, byPrefix, targets, details, results: [] };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  let completed = 0;
  const results = await mapConcurrent(targets, async (image) => {
    let result;
    try {
      result = await downloadImage(image);
    } catch (error) {
      result = { ...image, status: "failed", error: error.message };
      console.error(`Failed: ${image.filename}: ${error.message}`);
    }
    completed += 1;
    if (completed % 25 === 0 || completed === targets.length) {
      console.log(`Images checked: ${completed}/${targets.length}`);
    }
    return result;
  });
  const summary = {
    cards: uniqueCards.size,
    images: targets.length,
    downloaded: results.filter((result) => result.status === "downloaded").length,
    existing: results.filter((result) => result.status === "existing").length,
    failed: results.filter((result) => result.status === "failed").length,
    totalBytes: results.reduce((sum, result) => sum + (result.bytes ?? 0), 0),
  };
  await writeFile(reportPath, `${JSON.stringify({ ...report, completedAt: new Date().toISOString(), summary, results }, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, reportPath, outputDirectory }, null, 2));
  if (summary.failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
