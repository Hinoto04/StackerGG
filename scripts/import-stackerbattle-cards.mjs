import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

config({ path: ".env.local" });
config();

const STACKER_API_BASE = "https://stackerbattle.com/api/cards";
const PAGE_SIZE = 50;
const TYPE_MAP = {
  main: "MAIN",
  sub: "SUB",
  active: "ACTIVE",
};

const { values: options } = parseArgs({
  options: {
    prefix: { type: "string" },
    "new-only": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "pack-release-date": { type: "string" },
    "source-file": { type: "string" },
    "tags-file": { type: "string" },
  },
});

const codePrefix = options.prefix ? normalizeCodePrefix(options.prefix) : null;
const releaseDate = options["pack-release-date"];
if (releaseDate && (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || !Number.isFinite(Date.parse(releaseDate)) || new Date(releaseDate).toISOString().slice(0, 10) !== releaseDate)) {
  throw new Error("pack-release-date must be a valid YYYY-MM-DD date");
}
if (releaseDate && !codePrefix) {
  throw new Error("Use --prefix when creating a pack with --pack-release-date");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }),
});

function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toNullableText(value) {
  const text = toText(value);
  return text || null;
}

function normalizePackName(value) {
  return toText(value)
    .replace(/^[A-Z]+-?\d+\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCodePrefix(value) {
  return toText(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function getCodePrefixFromCollectionNumber(collectionNumber) {
  return normalizeCodePrefix(collectionNumber.split("-")[0] ?? "");
}

function mapCardType(stackerType) {
  const cardType = TYPE_MAP[toText(stackerType).toLowerCase()];

  if (!cardType) {
    throw new Error(`Unknown stacker_type: ${stackerType}`);
  }

  return cardType;
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  return response.json();
}

async function fetchListItems() {
  const items = [];

  for (let offset = 0; ; ) {
    const url = `${STACKER_API_BASE}/list/?offset=${offset}&limit=${PAGE_SIZE}`;
    const payload = await fetchJson(url);
    const pageItems = payload?.data?.data;
    if (!Array.isArray(pageItems)) {
      throw new Error(`Unexpected card list response: ${url}`);
    }
    items.push(...pageItems);

    if (pageItems.length === 0) {
      break;
    }

    offset += pageItems.length;
  }

  return items;
}

function getCardData(detail) {
  const collectionNumber = toText(detail.card_id);
  const cardType = mapCardType(detail.stacker_type);
  const data = {
    name: toText(detail.name),
    cardType,
    power: detail.main_power === null || detail.main_power === undefined ? null : Number(detail.main_power),
    activeCost: toText(detail.active_cost ?? 0),
    activeEffect: toText(detail.active_effect),
    mainCost: cardType === "MAIN" ? toText(detail.main_cost ?? 0) : null,
    mainEffect: cardType === "MAIN" ? toNullableText(detail.main_effect) : null,
    subCost: cardType === "SUB" ? toText(detail.sub_cost ?? 0) : null,
    subEffect: cardType === "SUB" ? toNullableText(detail.sub_effect) : null,
    collectionNumber,
  };

  if (!collectionNumber || !data.name || !data.activeEffect ||
      (cardType === "MAIN" && (!data.mainEffect || !Number.isInteger(data.power))) ||
      (cardType === "SUB" && !data.subEffect)) {
    throw new Error(`Incomplete card data: ${collectionNumber}`);
  }
  for (const cost of [data.activeCost, data.mainCost, data.subCost].filter((value) => value !== null)) {
    if (!/^\d+$/.test(cost)) {
      throw new Error(`Invalid cost for ${collectionNumber}: ${cost}`);
    }
  }
  if (!Array.isArray(detail.releases) || detail.releases.length === 0) {
    throw new Error(`No releases for ${collectionNumber}`);
  }
  for (const release of detail.releases) {
    if (!toText(release.release_name) || !Array.isArray(release.rarities) || release.rarities.length === 0 ||
        release.rarities.some((rarity) => typeof rarity !== "string" || !/^[A-Z]+$/.test(rarity))) {
      throw new Error(`Invalid release for ${collectionNumber}`);
    }
  }

  return data;
}

async function fetchDetail(cardId, rarity) {
  const payload = await fetchJson(`${STACKER_API_BASE}/detail/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ card_id: cardId, rarity }),
  });

  if (!payload?.data) {
    throw new Error(`Detail not found: ${cardId} ${rarity}`);
  }

  return payload.data;
}

async function getPackMap() {
  const packs = await prisma.pack.findMany({
    select: {
      id: true,
      name: true,
      codePrefix: true,
    },
  });

  const byName = new Map();
  const byCode = new Map();

  for (const pack of packs) {
    byName.set(normalizePackName(pack.name), pack);
    byCode.set(normalizeCodePrefix(pack.codePrefix), pack);
  }

  return { byName, byCode };
}

function findPack(packMap, releaseName, collectionNumber) {
  const byName = packMap.byName.get(normalizePackName(releaseName));

  if (byName) {
    return byName;
  }

  return packMap.byCode.get(getCodePrefixFromCollectionNumber(collectionNumber)) ?? null;
}

async function main() {
  const snapshot = options["source-file"]
    ? JSON.parse(await readFile(options["source-file"], "utf8"))
    : null;
  if (snapshot && !Array.isArray(snapshot.details)) {
    throw new Error("Source file must contain a details array");
  }
  const tagsByCode = options["tags-file"]
    ? JSON.parse(await readFile(options["tags-file"], "utf8"))
    : null;
  const existingCards = await prisma.card.findMany({ select: { collectionNumber: true } });
  const existingCodes = new Set(existingCards.map((card) => card.collectionNumber));
  const listItems = snapshot ? snapshot.details : await fetchListItems();
  const firstItemByCardId = new Map();

  for (const item of listItems) {
    if (codePrefix && getCodePrefixFromCollectionNumber(toText(item.card_id)) !== codePrefix) {
      continue;
    }
    if (options["new-only"] && existingCodes.has(toText(item.card_id))) {
      continue;
    }
    if (!firstItemByCardId.has(item.card_id)) {
      firstItemByCardId.set(item.card_id, item);
    }
  }

  const details = [];

  for (const item of firstItemByCardId.values()) {
    details.push(snapshot ? item : await fetchDetail(item.card_id, item.rarity));
  }

  const packMap = await getPackMap();
  const missingPacks = new Map();
  let plannedReleases = 0;
  for (const detail of details) {
    getCardData(detail);
    if (tagsByCode && (!Object.hasOwn(tagsByCode, detail.card_id) ||
        !Array.isArray(tagsByCode[detail.card_id]) ||
        tagsByCode[detail.card_id].some((tag) => typeof tag !== "string" || tag.includes("/")))) {
      throw new Error(`Missing or invalid reviewed tags for ${detail.card_id}`);
    }
    for (const release of detail.releases) {
      plannedReleases += new Set(release.rarities).size;
      if (findPack(packMap, release.release_name, detail.card_id)) {
        continue;
      }
      const prefix = getCodePrefixFromCollectionNumber(detail.card_id);
      if (!releaseDate || prefix !== codePrefix) {
        throw new Error(`Pack not found for ${detail.card_id}: ${release.release_name}. Supply --prefix and --pack-release-date to create it.`);
      }
      const name = normalizePackName(release.release_name);
      if (missingPacks.has(prefix) && missingPacks.get(prefix).name !== name) {
        throw new Error(`Conflicting pack names for ${prefix}`);
      }
      missingPacks.set(prefix, { name, codePrefix: prefix, releaseDate: new Date(`${releaseDate}T00:00:00.000Z`) });
    }
  }
  console.log(JSON.stringify({
    dryRun: options["dry-run"],
    newOnly: options["new-only"],
    prefix: codePrefix,
    plannedCards: details.length,
    plannedReleases,
    packsToCreate: [...missingPacks.values()],
    types: details.reduce((counts, detail) => {
      const type = mapCardType(detail.stacker_type);
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {}),
  }, null, 2));
  if (options["dry-run"] || details.length === 0) {
    return;
  }
  let cardsUpserted = 0;
  let releasesUpserted = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const data of missingPacks.values()) {
        const pack = await tx.pack.upsert({ where: { codePrefix: data.codePrefix }, update: {}, create: data });
        packMap.byCode.set(data.codePrefix, pack);
        packMap.byName.set(normalizePackName(data.name), pack);
      }
      for (const detail of details) {
        const data = getCardData(detail);
        const collectionNumber = data.collectionNumber;
        const reviewedTags = tagsByCode?.[collectionNumber];
        const card = await tx.card.upsert({
          where: { collectionNumber },
          update: options["new-only"] ? {} : data,
          create: {
            ...data,
            ...(reviewedTags ? { tags: reviewedTags.length ? `${[...new Set(reviewedTags)].join("/")}/` : "" } : {}),
          },
          select: { id: true },
        });
        cardsUpserted += 1;

        for (const release of detail.releases ?? []) {
          const pack = findPack(packMap, release.release_name, collectionNumber);

          if (!pack) {
            throw new Error(`Pack not found for ${collectionNumber}: ${release.release_name}`);
          }

          for (const rarity of new Set(release.rarities ?? [])) {
            await tx.cardRelease.upsert({
              where: {
                collectionNumber_rarity: {
                  collectionNumber,
                  rarity,
                },
              },
              update: options["new-only"] ? {} : {
                cardName: toText(detail.name),
                cardId: card.id,
                packId: pack.id,
              },
              create: {
                cardName: toText(detail.name),
                cardId: card.id,
                rarity,
                packId: pack.id,
                collectionNumber,
              },
            });
            releasesUpserted += 1;
          }
        }
      }
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  console.log(
    JSON.stringify(
      {
        sourceItems: listItems.length,
        uniqueCards: details.length,
        cardsUpserted,
        releasesUpserted,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
