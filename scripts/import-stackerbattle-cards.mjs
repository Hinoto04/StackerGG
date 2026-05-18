import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const STACKER_API_BASE = "https://stackerbattle.com/api/cards";
const PAGE_SIZE = 50;
const TYPE_MAP = {
  main: "MAIN",
  sub: "SUB",
  active: "ACTIVE",
};

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
  const response = await fetch(url, init);

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
    const pageItems = payload?.data?.data ?? [];
    items.push(...pageItems);

    if (pageItems.length === 0) {
      break;
    }

    offset += pageItems.length;
  }

  return items;
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
  const listItems = await fetchListItems();
  const firstItemByCardId = new Map();

  for (const item of listItems) {
    if (!firstItemByCardId.has(item.card_id)) {
      firstItemByCardId.set(item.card_id, item);
    }
  }

  const details = [];

  for (const item of firstItemByCardId.values()) {
    details.push(await fetchDetail(item.card_id, item.rarity));
  }

  const packMap = await getPackMap();
  let cardsUpserted = 0;
  let releasesUpserted = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const detail of details) {
        const collectionNumber = toText(detail.card_id);
        const cardType = mapCardType(detail.stacker_type);
        const card = await tx.card.upsert({
          where: { collectionNumber },
          update: {
            name: toText(detail.name),
            cardType,
            power: detail.main_power === null || detail.main_power === undefined ? null : Number(detail.main_power),
            activeCost: toText(detail.active_cost),
            activeEffect: toText(detail.active_effect),
            mainCost: cardType === "MAIN" ? toNullableText(detail.main_cost) : null,
            mainEffect: cardType === "MAIN" ? toNullableText(detail.main_effect) : null,
            subCost: cardType === "SUB" ? toNullableText(detail.sub_cost) : null,
            subEffect: cardType === "SUB" ? toNullableText(detail.sub_effect) : null,
          },
          create: {
            name: toText(detail.name),
            cardType,
            power: detail.main_power === null || detail.main_power === undefined ? null : Number(detail.main_power),
            activeCost: toText(detail.active_cost),
            activeEffect: toText(detail.active_effect),
            mainCost: cardType === "MAIN" ? toNullableText(detail.main_cost) : null,
            mainEffect: cardType === "MAIN" ? toNullableText(detail.main_effect) : null,
            subCost: cardType === "SUB" ? toNullableText(detail.sub_cost) : null,
            subEffect: cardType === "SUB" ? toNullableText(detail.sub_effect) : null,
            collectionNumber,
          },
          select: { id: true },
        });
        cardsUpserted += 1;

        for (const release of detail.releases ?? []) {
          const pack = findPack(packMap, release.release_name, collectionNumber);

          if (!pack) {
            throw new Error(`Pack not found for ${collectionNumber}: ${release.release_name}`);
          }

          for (const rarity of release.rarities ?? []) {
            await tx.cardRelease.upsert({
              where: {
                collectionNumber_rarity: {
                  collectionNumber,
                  rarity,
                },
              },
              update: {
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
    { timeout: 120_000 },
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
