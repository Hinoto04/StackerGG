import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRepresentativeCardImageUrl, type CardType } from "@/data/cards";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";

type RouteParams = {
  id: string;
};

type CaptureCard = {
  cardType: string;
  cost: string;
  costBadgeType: string;
  id: string;
  imageUrl: string;
  isField: boolean;
  name: string;
  slotType: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDTH = 1920;
const HEIGHT = 1080;
const CARD_WIDTH = 145;
const CARD_HEIGHT = 203;
const CARD_GAP = 20;
const CAPTURE_CACHE_TTL_MS = 60 * 60 * 1000;
const CAPTURE_CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), ".runtime-logs", "deck-captures");
const PRETENDARD_STATIC_FONT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "pretendard", "dist", "web", "static", "woff2");
const PRETENDARD_VARIABLE_FONT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "pretendard", "dist", "web", "variable", "woff2");
const PRETENDARD_FONT_FILES = [
  { fileName: "PretendardVariable.woff2", fontDir: PRETENDARD_VARIABLE_FONT_DIR },
  { fileName: "Pretendard-Regular.woff2", fontDir: PRETENDARD_STATIC_FONT_DIR },
  { fileName: "Pretendard-Bold.woff2", fontDir: PRETENDARD_STATIC_FONT_DIR },
  { fileName: "Pretendard-Black.woff2", fontDir: PRETENDARD_STATIC_FONT_DIR },
];
const captureDeleteTimers = new Map<string, ReturnType<typeof setTimeout>>();

const ROW_LAYOUTS: Record<CardType, { color: string; label: string; rows: number[]; y: number }> = {
  MAIN: { color: "#ff6464", label: "MAIN", rows: [3], y: 76 },
  SUB: { color: "#5ee7d6", label: "SUB", rows: [9], y: 335 },
  ACTIVE: { color: "#ffe84d", label: "ACTIVE", rows: [11, 10], y: 565 },
};

export const dynamic = "force-dynamic";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getFontFileUrl(fontDir: string, fileName: string) {
  return pathToFileURL(path.join(fontDir, fileName)).href;
}

function getPretendardFontFaceCss() {
  return `
    @font-face {
      font-family: 'Pretendard';
      src: url('${getFontFileUrl(PRETENDARD_VARIABLE_FONT_DIR, "PretendardVariable.woff2")}') format('woff2');
      font-weight: 400 900;
      font-style: normal;
    }
    @font-face {
      font-family: 'Pretendard';
      src: url('${getFontFileUrl(PRETENDARD_STATIC_FONT_DIR, "Pretendard-Regular.woff2")}') format('woff2');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'Pretendard';
      src: url('${getFontFileUrl(PRETENDARD_STATIC_FONT_DIR, "Pretendard-Bold.woff2")}') format('woff2');
      font-weight: 800;
      font-style: normal;
    }
    @font-face {
      font-family: 'Pretendard';
      src: url('${getFontFileUrl(PRETENDARD_STATIC_FONT_DIR, "Pretendard-Black.woff2")}') format('woff2');
      font-weight: 900;
      font-style: normal;
    }
    text {
      font-family: 'Pretendard', 'Arial', sans-serif;
    }
  `;
}

async function getPretendardFontSignature() {
  const hash = createHash("sha1");

  for (const { fileName, fontDir } of PRETENDARD_FONT_FILES) {
    const filePath = path.join(fontDir, fileName);
    const fileStat = await stat(filePath).catch(() => null);

    hash.update(fileName);
    hash.update(fileStat ? `${fileStat.size}:${fileStat.mtimeMs}` : "missing");
  }

  return hash.digest("hex").slice(0, 12);
}

function expandCards(
  items: {
    id: string;
    isField: boolean;
    quantity: number;
    slotType: string;
    card: {
      activeCost: string;
      cardType: string;
      collectionNumber: string;
      mainCost: string | null;
      name: string;
      releases: { collectionNumber: string; rarity: string }[];
      subCost: string | null;
    };
  }[],
  type: CardType,
) {
  return items
    .filter((item) => item.slotType === type)
    .sort((a, b) => Number(b.isField) - Number(a.isField) || a.id.localeCompare(b.id))
    .flatMap((item) =>
      Array.from({ length: Math.max(1, item.quantity) }, (_, index): CaptureCard => {
        const isFirstCopy = index === 0;
        const isFieldCopy = item.isField && isFirstCopy;
        const costBadgeType = isFieldCopy ? item.card.cardType : "ACTIVE";

        return {
          cardType: item.card.cardType,
          cost: isFieldCopy ? getCardCost(item.card) : getActiveCost(item.card),
          costBadgeType,
          id: `${item.id}-${index}`,
          imageUrl: getRepresentativeCardImageUrl(item.card, "list"),
          isField: isFieldCopy,
          name: item.card.name,
          slotType: item.slotType,
        };
      }),
    );
}

function getActiveCost(card: { activeCost: string }) {
  return card.activeCost.trim() || "0";
}

function getCardCost(card: { activeCost: string; cardType: string; mainCost: string | null; subCost: string | null }) {
  if (card.cardType === "MAIN") {
    return card.mainCost?.trim() || "0";
  }

  if (card.cardType === "SUB") {
    return card.subCost?.trim() || "0";
  }

  return card.activeCost.trim() || "0";
}

function getCostBadgePalette(cardType: string) {
  if (cardType === "MAIN") {
    return { fill: "#df3f44", stroke: "#ffffff", text: "#ffffff" };
  }

  if (cardType === "SUB") {
    return { fill: "#2fbcb2", stroke: "#ffffff", text: "#ffffff" };
  }

  return { fill: "#f1d545", stroke: "#ffffff", text: "#241d08" };
}

function renderCostBadge(card: CaptureCard, x: number, y: number) {
  const palette = getCostBadgePalette(card.costBadgeType);
  const cx = x + 23;
  const cy = y + 23;
  const points = [
    [cx, cy - 22],
    [cx + 20, cy - 11],
    [cx + 20, cy + 11],
    [cx, cy + 22],
    [cx - 20, cy + 11],
    [cx - 20, cy - 11],
  ]
    .map((point) => point.join(","))
    .join(" ");

  return `
    <polygon points="${points}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="3" />
    <text x="${cx}" y="${cy + 8}" text-anchor="middle" fill="${palette.text}" font-size="23" font-weight="900">${escapeXml(card.cost)}</text>`;
}

function renderCard(card: CaptureCard, x: number, y: number) {
  const stroke = card.isField ? "#f7d767" : "rgba(255,255,255,0.78)";
  const strokeWidth = card.isField ? 6 : 3;
  const filter = card.isField ? ' filter="url(#fieldGlow)"' : "";

  return `
    <g${filter}>
      <rect x="${x - 5}" y="${y - 5}" width="${CARD_WIDTH + 10}" height="${CARD_HEIGHT + 10}" rx="10" fill="rgba(255,255,255,0.16)" stroke="${stroke}" stroke-width="${strokeWidth}" />
      <image href="${escapeXml(card.imageUrl)}" x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="xMidYMid meet" />
      ${renderCostBadge(card, x, y)}
    </g>`;
}

function renderSection(type: CardType, cards: CaptureCard[]) {
  const layout = ROW_LAYOUTS[type];
  let cardIndex = 0;
  const renderedRows: string[] = [];

  for (let rowIndex = 0; rowIndex < layout.rows.length; rowIndex += 1) {
    const rowCapacity = layout.rows[rowIndex];
    const rowCards = cards.slice(cardIndex, cardIndex + rowCapacity);
    const y = layout.y + rowIndex * (CARD_HEIGHT + 18);
    const xStart = 92;

    renderedRows.push(
      rowCards
        .map((card, index) => renderCard(card, xStart + index * (CARD_WIDTH + CARD_GAP), y))
        .join(""),
    );
    cardIndex += rowCapacity;
  }

  return `
    <g>
      <text x="67" y="${layout.y + CARD_HEIGHT / 2}" text-anchor="middle" transform="rotate(-90 67 ${layout.y + CARD_HEIGHT / 2})" fill="${layout.color}" font-size="30" font-weight="900" letter-spacing="2">
        ${layout.label}
      </text>
      ${renderedRows.join("")}
    </g>`;
}

function renderDeckCaptureSvg(deck: {
  author: { displayName: string | null; loginId: string };
  id: string;
  items: {
    id: string;
    isField: boolean;
    quantity: number;
    slotType: string;
    card: {
      activeCost: string;
      cardType: string;
      collectionNumber: string;
      mainCost: string | null;
      name: string;
      releases: { collectionNumber: string; rarity: string }[];
      subCost: string | null;
    };
  }[];
  name: string;
}) {
  const authorLabel = deck.author.displayName || deck.author.loginId;
  const mainCards = expandCards(deck.items, "MAIN");
  const subCards = expandCards(deck.items, "SUB");
  const activeCards = expandCards(deck.items, "ACTIVE");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Pretendard, Arial, sans-serif">
  <defs>
    <style><![CDATA[
${getPretendardFontFaceCss()}
    ]]></style>
    <filter id="fieldGlow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#f7d767" flood-opacity="0.86" />
    </filter>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f1216" stop-opacity="0.8" />
      <stop offset="0.48" stop-color="#111318" stop-opacity="0.62" />
      <stop offset="1" stop-color="#050607" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#090b0f" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)" />
  <rect y="820" width="${WIDTH}" height="260" fill="rgba(0,0,0,0.28)" />

  <g text-anchor="end">
    <text x="1848" y="92" fill="#ffffff" font-size="34" font-weight="900">STACKER GG DECK</text>
    <text x="1848" y="146" fill="#ffffff" font-size="48" font-weight="900">${escapeXml(deck.name)}</text>
    <text x="1848" y="194" fill="#e8e8e8" font-size="30" font-weight="800">by ${escapeXml(authorLabel)}</text>
  </g>

  ${renderSection("MAIN", mainCards)}
  ${renderSection("SUB", subCards)}
  ${renderSection("ACTIVE", activeCards)}

  <text x="1848" y="1045" text-anchor="end" fill="rgba(255,255,255,0.82)" font-size="20">StackerGG · ${escapeXml(deck.id)}</text>
</svg>`;
}

async function cleanupExpiredCaptures() {
  await mkdir(CAPTURE_CACHE_DIR, { recursive: true });

  const now = Date.now();
  const entries = await readdir(CAPTURE_CACHE_DIR, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".jpg") || entry.name.endsWith(".svg")))
      .map(async (entry) => {
        const filePath = path.join(CAPTURE_CACHE_DIR, entry.name);
        const fileStat = await stat(filePath).catch(() => null);

        if (fileStat && now - fileStat.mtimeMs > CAPTURE_CACHE_TTL_MS) {
          await unlink(filePath).catch(() => undefined);
        }
      }),
  );
}

function scheduleCaptureDeletion(filePath: string) {
  const previousTimer = captureDeleteTimers.get(filePath);

  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  const timer = setTimeout(() => {
    unlink(filePath)
      .catch(() => undefined)
      .finally(() => captureDeleteTimers.delete(filePath));
  }, CAPTURE_CACHE_TTL_MS);

  timer.unref?.();
  captureDeleteTimers.set(filePath, timer);
}

async function readFreshCaptureCache(filePath: string) {
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat) {
    return null;
  }

  if (Date.now() - fileStat.mtimeMs > CAPTURE_CACHE_TTL_MS) {
    await unlink(filePath).catch(() => undefined);
    return null;
  }

  return readFile(filePath);
}

async function fetchImageDataUri(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`카드 이미지를 불러오지 못했습니다. (${response.status})`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const pngBuffer = await sharp(imageBuffer).png().toBuffer();

  return `data:image/png;base64,${pngBuffer.toString("base64")}`;
}

async function inlineSvgImages(svg: string) {
  const imageUrls = Array.from(new Set([...svg.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((match) => match[1])));
  const replacements = new Map<string, string>();

  await Promise.all(
    imageUrls.map(async (url) => {
      replacements.set(url, await fetchImageDataUri(url));
    }),
  );

  let inlinedSvg = svg;

  for (const [url, dataUri] of replacements) {
    inlinedSvg = inlinedSvg.replaceAll(url, dataUri);
  }

  return inlinedSvg;
}

async function renderDeckCaptureJpeg(deck: Parameters<typeof renderDeckCaptureSvg>[0]) {
  const svg = await inlineSvgImages(renderDeckCaptureSvg(deck));

  return sharp(Buffer.from(svg))
    .jpeg({
      mozjpeg: true,
      quality: 92,
    })
    .toBuffer();
}

function createJpegDownloadResponse(body: Buffer, deckName: string) {
  const fileName = encodeURIComponent(`${deckName}-deck.jpg`);
  const arrayBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(arrayBuffer).set(body);
  const blob = new Blob([arrayBuffer], { type: "image/jpeg" });

  return new Response(blob, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      "Content-Type": "image/jpeg",
      Expires: "0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(_: Request, { params }: { params: Promise<RouteParams> }) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const deck = await prisma.deck.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      author: {
        select: {
          displayName: true,
          loginId: true,
        },
      },
      items: {
        orderBy: [{ slotType: "asc" }, { displayOrder: "asc" }],
        select: {
          id: true,
          isField: true,
          quantity: true,
          slotType: true,
          card: {
            select: {
              activeCost: true,
              cardType: true,
              collectionNumber: true,
              mainCost: true,
              name: true,
              releases: {
                select: {
                  collectionNumber: true,
                  rarity: true,
                },
              },
              subCost: true,
            },
          },
        },
      },
    },
  });

  if (!deck) {
    return new Response("Not found", { status: 404 });
  }

  await cleanupExpiredCaptures();

  const fontSignature = await getPretendardFontSignature();
  const cachePath = path.join(CAPTURE_CACHE_DIR, `${deck.id}-${fontSignature}.jpg`);
  const cachedJpeg = await readFreshCaptureCache(cachePath);

  if (cachedJpeg) {
    scheduleCaptureDeletion(cachePath);
    return createJpegDownloadResponse(cachedJpeg, deck.name);
  }

  const jpeg = await renderDeckCaptureJpeg(deck);
  await writeFile(cachePath, jpeg);
  scheduleCaptureDeletion(cachePath);

  return createJpegDownloadResponse(jpeg, deck.name);
}
