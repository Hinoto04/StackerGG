import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { CARD_TYPES, isCardType, type CardType } from "@/data/cards";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DeckBuilder, type BuilderCard, type DeckItem } from "../../new/DeckBuilder";
import { updateDeckAction } from "./actions";

export const dynamic = "force-dynamic";

type RouteParams = {
  id: string;
};

const CARD_TYPE_ORDER: Record<CardType, number> = {
  MAIN: 0,
  SUB: 1,
  ACTIVE: 2,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function getDeck(id: string) {
  const deckId = id.trim();

  if (!UUID_PATTERN.test(deckId)) {
    return null;
  }

  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: {
      id: true,
      name: true,
      authorId: true,
      description: true,
    },
  });

  if (!deck) {
    return null;
  }

  const items = await prisma.deckCard.findMany({
    where: {
      deckId: deck.id,
    },
    orderBy: {
      displayOrder: "asc",
    },
    select: {
      cardId: true,
      slotType: true,
      quantity: true,
    },
  });

  return {
    ...deck,
    items,
  };
}

function getInitialItems(items: { cardId: string; slotType: string; quantity: number }[]): DeckItem[] {
  return items.flatMap((item) => {
    if (!isCardType(item.slotType)) {
      return [];
    }

    return [
      {
        cardId: item.cardId,
        slotType: item.slotType,
        quantity: item.quantity,
      },
    ];
  });
}

export default async function EditDeckPage({ params }: { params: Promise<RouteParams> }) {
  const { id } = await params;
  const user = await requireUser();
  const deck = await getDeck(id);

  if (!deck) {
    notFound();
  }

  if (deck.authorId !== user.id) {
    redirect(`/decks/${deck.id}`);
  }

  const cards = await getDeckBuilderCards();
  const action = updateDeckAction.bind(null, deck.id);

  return (
    <>
      <SiteHeader active="decks" />

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">DECK EDITOR</div>
            <h1>덱 수정</h1>
            <p>작성한 덱의 이름, 설명, 카드 구성을 수정합니다.</p>
          </div>
          <div className="head-chips">
            {CARD_TYPES.map((type) => (
              <span key={type}>{type}</span>
            ))}
            <a className="button ghost-button" href={`/decks/${deck.id}`}>
              상세 보기
            </a>
          </div>
        </section>

        <DeckBuilder
          action={action}
          cards={cards}
          failureTitle="수정 실패"
          initialDescription={deck.description ?? ""}
          initialItems={getInitialItems(deck.items)}
          initialName={deck.name}
          pendingLabel="수정 중"
          submitLabel="수정 저장"
        />
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Deck Builder</span>
        <span>{deck.id}</span>
      </footer>
    </>
  );
}
