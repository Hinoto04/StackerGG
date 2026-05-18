import { DeckBuilder, type BuilderCard } from "./DeckBuilder";
import { SiteHeader } from "@/components/SiteHeader";
import { CARD_TYPES, isCardType, type CardType } from "@/data/cards";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CARD_TYPE_ORDER: Record<CardType, number> = {
  MAIN: 0,
  SUB: 1,
  ACTIVE: 2,
};

async function getDeckBuilderCards(): Promise<BuilderCard[]> {
  const cards = await prisma.card.findMany({
    orderBy: [{ collectionNumber: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      cardType: true,
      power: true,
      activeCost: true,
      mainCost: true,
      subCost: true,
      collectionNumber: true,
      releases: {
        select: {
          collectionNumber: true,
          rarity: true,
        },
      },
    },
  });

  return cards
    .flatMap((card) => {
      if (!isCardType(card.cardType)) {
        return [];
      }

      return [{ ...card, cardType: card.cardType }];
    })
    .sort((a, b) => CARD_TYPE_ORDER[a.cardType] - CARD_TYPE_ORDER[b.cardType] || a.collectionNumber.localeCompare(b.collectionNumber));
}

export default async function NewDeckPage() {
  await requireUser();
  const cards = await getDeckBuilderCards();

  return (
    <>
      <SiteHeader active="decks" />

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">DECK BUILDER</div>
            <h1>덱 작성</h1>
            <p>메인 3장, 서브 9장, 액티브 21장으로 스태커배틀 덱을 구성합니다.</p>
          </div>
          <div className="head-chips">
            {CARD_TYPES.map((type) => (
              <span key={type}>{type}</span>
            ))}
            <span>카드 {cards.length}장</span>
            <a className="button ghost-button" href="/decks">
              덱 목록
            </a>
          </div>
        </section>

        <DeckBuilder cards={cards} />
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Deck Builder</span>
        <span>MAIN 3 / SUB 9 / ACTIVE 21</span>
      </footer>
    </>
  );
}
