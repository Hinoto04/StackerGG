import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });
const { values: options } = parseArgs({
  options: {
    manifest: { type: "string", default: "scripts/data/stacker-promo-releases.json" },
    "source-file": { type: "string" },
    report: { type: "string", default: ".temp/promo-release-import-report.json" },
    apply: { type: "boolean", default: false },
  },
});
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }),
});
const TYPES = { main: "MAIN", sub: "SUB", active: "ACTIVE" };
const compact = (value) => String(value ?? "").replace(/\s/g, "");

function parseDate(value) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid pack release date: ${value}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

async function fetchDetail(collectionNumber, rarity) {
  const response = await fetch("https://stackerbattle.com/api/cards/detail/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ card_id: collectionNumber, rarity }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Official detail HTTP ${response.status}: ${collectionNumber}`);
  }
  return (await response.json()).data;
}

function verifyCard(card, detail) {
  if (compact(card.name) !== compact(detail.name) || card.cardType !== TYPES[detail.stacker_type] ||
      Number(card.activeCost) !== Number(detail.active_cost ?? 0) || compact(card.activeEffect) !== compact(detail.active_effect)) {
    throw new Error(`Promo is not equivalent to the selected card: ${detail.card_id} -> ${card.collectionNumber}`);
  }
  if (card.cardType === "MAIN" && (card.power !== detail.main_power ||
      Number(card.mainCost) !== Number(detail.main_cost ?? 0) || compact(card.mainEffect) !== compact(detail.main_effect))) {
    throw new Error(`MAIN effect mismatch: ${detail.card_id}`);
  }
  if (card.cardType === "SUB" && (Number(card.subCost) !== Number(detail.sub_cost ?? 0) ||
      compact(card.subEffect) !== compact(detail.sub_effect))) {
    throw new Error(`SUB effect mismatch: ${detail.card_id}`);
  }
}

async function snapshot(db) {
  return {
    cards: await db.card.findMany({ orderBy: { id: "asc" } }),
    packs: await db.pack.findMany({ orderBy: { id: "asc" } }),
    releases: await db.cardRelease.findMany({ orderBy: { id: "asc" } }),
  };
}

async function main() {
  const manifest = JSON.parse(await readFile(options.manifest, "utf8"));
  if (!Array.isArray(manifest.packs) || !Array.isArray(manifest.releases)) {
    throw new Error("Manifest must contain packs and releases arrays");
  }
  const source = options["source-file"] ? JSON.parse(await readFile(options["source-file"], "utf8")) : null;
  if (source && !Array.isArray(source.details)) {
    throw new Error("Source file must contain a details array");
  }
  const sourceByCode = new Map((source?.details ?? []).map((detail) => [detail.card_id, detail]));
  const before = await snapshot(prisma);
  const cardsByCode = new Map(before.cards.map((card) => [card.collectionNumber, card]));
  const packsByCode = new Map(before.packs.map((pack) => [pack.codePrefix, pack]));
  const releasesByKey = new Map(before.releases.map((release) => [`${release.collectionNumber}-${release.rarity}`, release]));
  const plannedPacks = new Map();
  for (const pack of manifest.packs) {
    if (!pack.name || !/^[A-Z0-9-]+$/.test(pack.codePrefix) || plannedPacks.has(pack.codePrefix)) {
      throw new Error(`Invalid or duplicate pack: ${pack.codePrefix}`);
    }
    const existing = packsByCode.get(pack.codePrefix);
    if (existing && existing.name !== pack.name) {
      throw new Error(`Pack name conflict: ${pack.codePrefix}`);
    }
    plannedPacks.set(pack.codePrefix, { ...pack, releaseDate: parseDate(pack.releaseDate), existing });
  }

  const plans = [];
  const targetKeys = new Set();
  const packCardRarities = new Set();
  for (const entry of manifest.releases) {
    const key = `${entry.collectionNumber}-${entry.rarity}`;
    if (!/^[A-Z0-9]+-(?:KR)?\d+$/.test(entry.collectionNumber) || !/^[A-Z]+$/.test(entry.rarity) || targetKeys.has(key)) {
      throw new Error(`Invalid or duplicate release: ${key}`);
    }
    targetKeys.add(key);
    const card = cardsByCode.get(entry.cardCollectionNumber);
    const pack = plannedPacks.get(entry.packCode);
    if (!card || !pack) {
      throw new Error(`Card or pack not found for ${key}`);
    }
    let detail = sourceByCode.get(entry.collectionNumber);
    if (!detail) {
      detail = await fetchDetail(entry.collectionNumber, entry.rarity);
      sourceByCode.set(entry.collectionNumber, detail);
    }
    if (detail?.card_id !== entry.collectionNumber || !Array.isArray(detail.releases) ||
        !detail.releases.some((release) => release.release_name === pack.name && release.rarities?.includes(entry.rarity))) {
      throw new Error(`Official release does not match the manifest: ${key} / ${pack.name}`);
    }
    verifyCard(card, detail);
    const uniqueKey = `${card.id}/${pack.codePrefix}/${entry.rarity}`;
    if (packCardRarities.has(uniqueKey)) {
      throw new Error(`Multiple printings violate the card/pack/rarity constraint: ${uniqueKey}`);
    }
    packCardRarities.add(uniqueKey);
    const existing = releasesByKey.get(key);
    if (existing && existing.cardId !== card.id) {
      throw new Error(`Release is linked to another card: ${key}`);
    }
    const status = !existing ? "create" : existing.packId === pack.existing?.id ? "unchanged" : "move";
    plans.push({ ...entry, cardId: card.id, cardName: detail.name, status, existingId: existing?.id });
  }

  const packsToCreate = [...plannedPacks.values()].filter((pack) => !pack.existing);
  const undatedPacks = packsToCreate.filter((pack) => pack.releaseDate === null).map((pack) => pack.name);
  const summary = {
    apply: options.apply,
    packsToCreate: packsToCreate.length,
    releasesToCreate: plans.filter((plan) => plan.status === "create").length,
    releasesToMove: plans.filter((plan) => plan.status === "move").length,
    unchanged: plans.filter((plan) => plan.status === "unchanged").length,
    undatedPacks,
    excluded: manifest.excluded ?? [],
    pending: manifest.pending ?? [],
  };
  const reportPath = resolve(options.report);
  await mkdir(dirname(reportPath), { recursive: true });
  const report = { checkedAt: new Date().toISOString(), source: manifest.source, summary, packs: manifest.packs, plans, details: [...sourceByCode.values()] };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (!options.apply) {
    return;
  }
  if (undatedPacks.length) {
    const columns = await prisma.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'packs' AND column_name = 'release_date'`;
    if (columns[0]?.is_nullable !== "YES") {
      throw new Error("Unknown release dates require nullable packs.release_date; no database changes were made.");
    }
  }

  const backupPath = resolve(`.temp/promo-release-db-before-${Date.now()}.json`);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify(before, null, 2)}\n`, { flag: "wx" });
  const result = await prisma.$transaction(async (tx) => {
    const idsByCode = new Map();
    for (const pack of plannedPacks.values()) {
      const row = await tx.pack.upsert({
        where: { codePrefix: pack.codePrefix },
        update: {},
        create: { name: pack.name, codePrefix: pack.codePrefix, releaseDate: pack.releaseDate },
      });
      assert.equal(row.name, pack.name);
      idsByCode.set(pack.codePrefix, row.id);
    }
    for (const plan of plans) {
      if (plan.status === "unchanged") {
        continue;
      }
      const packId = idsByCode.get(plan.packCode);
      if (plan.status === "move") {
        await tx.cardRelease.update({ where: { id: plan.existingId }, data: { packId } });
      } else {
        await tx.cardRelease.create({
          data: { cardId: plan.cardId, cardName: plan.cardName, packId, collectionNumber: plan.collectionNumber, rarity: plan.rarity },
        });
      }
    }
    const after = await snapshot(tx);
    assert.deepEqual(after.cards, before.cards, "Existing card data must stay unchanged");
    for (const pack of before.packs) {
      assert.deepEqual(after.packs.find((row) => row.id === pack.id), pack, "Existing packs must stay unchanged");
    }
    for (const release of before.releases) {
      const plan = plans.find((entry) => entry.status === "move" && entry.existingId === release.id);
      const expected = plan ? { ...release, packId: idsByCode.get(plan.packCode) } : release;
      assert.deepEqual(after.releases.find((row) => row.id === release.id), expected, "Only reviewed release pack links may change");
    }
    for (const plan of plans) {
      const row = after.releases.find((release) => release.collectionNumber === plan.collectionNumber && release.rarity === plan.rarity);
      assert.equal(row?.cardId, plan.cardId);
      assert.equal(row?.packId, idsByCode.get(plan.packCode));
    }
    assert.equal(after.releases.length, before.releases.length + summary.releasesToCreate);
    return { cards: after.cards.length, packs: after.packs.length, releases: after.releases.length };
  }, { timeout: 120_000, maxWait: 15_000 });
  await writeFile(reportPath, `${JSON.stringify({ ...report, appliedAt: new Date().toISOString(), backupPath, result }, null, 2)}\n`);
  console.log(JSON.stringify({ verified: true, result, backupPath, reportPath }, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
