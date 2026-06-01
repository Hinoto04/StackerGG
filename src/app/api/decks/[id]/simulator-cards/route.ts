import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRepresentativeCardImageUrl } from "@/data/cards";
import { prisma } from "@/lib/prisma";
import type { SimulatorCard } from "@/app/decks/[id]/simulator/SimulatorBoard";

type RouteParams = {
  id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getDeck(id: string) {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  return prisma.deck.findUnique({
    where: { id },
    include: {
      author: {
        select: {
          loginId: true,
          displayName: true,
        },
      },
      items: {
        orderBy: [{ slotType: "asc" }, { displayOrder: "asc" }],
        include: {
          card: {
            select: {
              id: true,
              name: true,
              cardType: true,
              power: true,
              activeCost: true,
              activeEffect: true,
              mainCost: true,
              mainEffect: true,
              subCost: true,
              subEffect: true,
              collectionNumber: true,
              releases: {
                select: {
                  collectionNumber: true,
                  rarity: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

function getSimulatorCards(deck: NonNullable<Awaited<ReturnType<typeof getDeck>>>) {
  let hasMainField = false;
  let subFieldCount = 0;

  return deck.items.flatMap((item) =>
    Array.from({ length: Math.max(item.quantity, 0) }, (_, copyIndex): SimulatorCard => {
      const imageUrl = getRepresentativeCardImageUrl(item.card, "list");
      let initialZone: SimulatorCard["initialZone"] = "deck";

      if (item.isField && copyIndex === 0) {
        if (item.card.cardType === "MAIN" && !hasMainField) {
          initialZone = "mainField";
          hasMainField = true;
        } else if (item.card.cardType === "SUB" && subFieldCount < 3) {
          subFieldCount += 1;
          initialZone = `subField${subFieldCount}` as SimulatorCard["initialZone"];
        }
      }

      return {
        id: `${item.id}-${copyIndex + 1}`,
        cardId: item.card.id,
        name: item.card.name,
        cardType: item.card.cardType,
        power: item.card.power,
        activeCost: item.card.activeCost,
        activeEffect: item.card.activeEffect,
        mainCost: item.card.mainCost,
        mainEffect: item.card.mainEffect,
        subCost: item.card.subCost,
        subEffect: item.card.subEffect,
        collectionNumber: item.card.collectionNumber,
        imageUrl,
        initialZone,
      };
    }),
  );
}

function getMultiplayerFieldReadiness(deck: NonNullable<Awaited<ReturnType<typeof getDeck>>>) {
  const mainCount = deck.items.filter((item) => item.isField && item.card.cardType === "MAIN").length;
  const subCount = deck.items.filter((item) => item.isField && item.card.cardType === "SUB").length;

  return {
    mainCount,
    ready: mainCount >= 1 && subCount >= 3,
    subCount,
  };
}

export async function GET(_: Request, { params }: { params: Promise<RouteParams> }) {
  const { id } = await params;
  const deck = await getDeck(id);

  if (!deck) {
    return NextResponse.json({ message: "Deck not found" }, { status: 404 });
  }

  const fieldReadiness = getMultiplayerFieldReadiness(deck);

  if (!fieldReadiness.ready) {
    return NextResponse.json(
      {
        message: `멀티 시뮬레이터에서는 필드 MAIN 1장과 SUB 3장이 준비된 덱만 사용할 수 있습니다. 현재 MAIN ${fieldReadiness.mainCount}/1, SUB ${fieldReadiness.subCount}/3입니다.`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    cards: getSimulatorCards(deck),
    deck: {
      id: deck.id,
      name: deck.name,
    },
    initialShuffleSeed: randomUUID(),
  });
}
