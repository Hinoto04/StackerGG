import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { getRepresentativeCardImageUrl } from "@/data/cards";
import { prisma } from "@/lib/prisma";
import { SimulatorBoard, type SimulatorCard } from "./SimulatorBoard";

export const dynamic = "force-dynamic";

type RouteParams = {
  id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export default async function DeckSimulatorPage({ params }: { params: Promise<RouteParams> }) {
  const { id } = await params;
  const deck = await getDeck(id);

  if (!deck) {
    notFound();
  }

  const simulatorCards = getSimulatorCards(deck);
  const authorLabel = deck.author.displayName || deck.author.loginId;
  const initialShuffleSeed = randomUUID();

  return (
    <>
      <SiteHeader active="decks" />

      <main className="site-shell content simulator-content">
        {simulatorCards.length > 0 ? (
          <SimulatorBoard cards={simulatorCards} initialShuffleSeed={initialShuffleSeed} opponentLifeDefault={25} />
        ) : (
          <section className="empty-panel">
            <strong>시뮬레이션할 카드가 없습니다.</strong>
            <p>덱에 카드를 추가한 뒤 다시 시도해주세요.</p>
            <a className="button primary-button" href={`/decks/${deck.id}/edit`}>
              덱 수정
            </a>
          </section>
        )}
      </main>

      <footer className="site-shell site-footer simulator-footer">
        <span>StackerGG Deck Simulator</span>
        <span>{authorLabel}</span>
      </footer>
    </>
  );
}
