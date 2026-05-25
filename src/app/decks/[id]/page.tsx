import { notFound } from "next/navigation";
import { CardImage } from "@/components/CardImage";
import { SiteHeader } from "@/components/SiteHeader";
import { CARD_TYPES, getRepresentativeCardImageUrl, type CardType } from "@/data/cards";
import { canManageDeck, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteParams = {
  id: string;
};

const DECK_LIMITS: Record<CardType, number> = {
  MAIN: 3,
  SUB: 9,
  ACTIVE: 21,
};

const TYPE_LABELS: Record<CardType, string> = {
  MAIN: "메인",
  SUB: "서브",
  ACTIVE: "액티브",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDeckCounts(items: { slotType: string; quantity: number }[]) {
  const counts: Record<CardType, number> = {
    MAIN: 0,
    SUB: 0,
    ACTIVE: 0,
  };

  for (const item of items) {
    if (CARD_TYPES.includes(item.slotType as CardType)) {
      counts[item.slotType as CardType] += item.quantity;
    }
  }

  return counts;
}

function getCostRank(cost: string) {
  const normalized = cost.trim();
  const numericCost = Number(normalized);

  if (normalized && Number.isFinite(numericCost)) {
    return {
      bucket: 0,
      number: numericCost,
      text: normalized,
    };
  }

  return {
    bucket: normalized ? 1 : 2,
    number: 0,
    text: normalized,
  };
}

function compareCosts(a: string, b: string) {
  const aRank = getCostRank(a);
  const bRank = getCostRank(b);

  return aRank.bucket - bRank.bucket || aRank.number - bRank.number || aRank.text.localeCompare(bRank.text);
}

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
          },
        },
      },
    },
  });
}

function getCardCost(card: { cardType: string; activeCost: string; mainCost: string | null; subCost: string | null }) {
  if (card.cardType === "MAIN") {
    return card.mainCost?.trim() || "0";
  }

  if (card.cardType === "SUB") {
    return card.subCost?.trim() || "0";
  }

  return card.activeCost.trim() || "0";
}

function getCostLabel(card: { cardType: string; activeCost: string; mainCost: string | null; subCost: string | null }) {
  return getCardCost(card);
}

function getActiveCostLabel(card: { activeCost: string }) {
  return card.activeCost.trim() || "0";
}

function compareCardsByDetailSort(
  a: {
    cardType: string;
    activeCost: string;
    mainCost: string | null;
    subCost: string | null;
    collectionNumber: string;
    name: string;
  },
  b: {
    cardType: string;
    activeCost: string;
    mainCost: string | null;
    subCost: string | null;
    collectionNumber: string;
    name: string;
  },
) {
  return (
    compareCosts(getCardCost(a), getCardCost(b)) ||
    compareCosts(getActiveCostLabel(a), getActiveCostLabel(b)) ||
    a.name.localeCompare(b.name, "ko-KR") ||
    a.collectionNumber.localeCompare(b.collectionNumber)
  );
}

function getItemsByType<
  T extends {
    slotType: string;
    displayOrder: number;
    isField: boolean;
    card: {
      cardType: string;
      activeCost: string;
      mainCost: string | null;
      subCost: string | null;
      collectionNumber: string;
      name: string;
    };
  },
>(items: T[], type: CardType) {
  return items
    .filter((item) => item.slotType === type)
    .sort(
      (a, b) =>
        Number(b.isField) - Number(a.isField) ||
        compareCardsByDetailSort(a.card, b.card) ||
        a.displayOrder - b.displayOrder,
    );
}

function getCostDistribution<
  T extends {
    slotType: string;
    displayOrder: number;
    quantity: number;
    isField: boolean;
    card: {
      cardType: string;
      activeCost: string;
      mainCost: string | null;
      subCost: string | null;
      collectionNumber: string;
      name: string;
    };
  },
>(items: T[], type: CardType) {
  const distribution = new Map<string, number>();

  for (const item of getItemsByType(items, type)) {
    const cost = getCostLabel(item.card);

    distribution.set(cost, (distribution.get(cost) ?? 0) + item.quantity);
  }

  return [...distribution]
    .map(([cost, count]) => ({ cost, count }))
    .sort((a, b) => compareCosts(a.cost, b.cost));
}

export default async function DeckDetailPage({ params }: { params: Promise<RouteParams> }) {
  const { id } = await params;
  const deck = await getDeck(id);

  if (!deck) {
    notFound();
  }

  const user = await getCurrentUser();
  const counts = getDeckCounts(deck.items);
  const canEdit = user?.id === deck.authorId;
  const canManage = canManageDeck(user, deck);
  const authorLabel = deck.author.displayName || deck.author.loginId;
  const costDistributions = CARD_TYPES.map((type) => ({
    type,
    rows: getCostDistribution(deck.items, type),
  }));

  return (
    <>
      <SiteHeader active="decks" />

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">DECK DETAIL</div>
            <h1>{deck.name}</h1>
            <p>{deck.description || "덱 설명이 없습니다."}</p>
          </div>
          <div className="head-chips">
            <span>{authorLabel}</span>
            {CARD_TYPES.map((type) => (
              <span key={type}>
                {type} {counts[type]}/{DECK_LIMITS[type]}
              </span>
            ))}
            <a className="button primary-button" href={`/decks/${deck.id}/simulator`}>
              시뮬레이터
            </a>
            <a className="button ghost-button" href={`/decks/${deck.id}/capture?format=jpg`} target="_blank" rel="noopener noreferrer">
              덱 캡쳐
            </a>
            {canEdit ? (
              <a className="button ghost-button" href={`/decks/${deck.id}/edit`}>
                덱 수정
              </a>
            ) : null}
            {canManage ? (
              <form action={`/decks/${deck.id}/delete`} method="post">
                <button className="button ghost-button" type="submit">
                  덱 삭제
                </button>
              </form>
            ) : null}
          </div>
        </section>

        <details className="cost-distribution-panel">
          <summary className="button ghost-button cost-distribution-toggle">코스트 분포</summary>
          <div className="cost-distribution-grid">
            {costDistributions.map(({ type, rows }) => {
              const maxCount = Math.max(...rows.map((row) => row.count), 1);

              return (
                <section className="cost-distribution-card" key={type}>
                  <div className="deck-section-head">
                    <h3>{TYPE_LABELS[type]}</h3>
                    <span>{type}</span>
                  </div>
                  <div className="cost-distribution-rows">
                    {rows.map((row) => (
                      <div className="cost-distribution-row" key={`${type}-${row.cost}`}>
                        <span className="cost-distribution-cost">{row.cost}</span>
                        <span className="cost-distribution-track">
                          <span className="cost-distribution-fill" style={{ width: `${(row.count / maxCount) * 100}%` }} />
                        </span>
                        <span className="cost-distribution-count">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </details>

        <div className="deck-detail-layout">
          {CARD_TYPES.map((type) => (
            <section className="deck-detail-section" key={type}>
              <div className="section-heading">
                <div>
                  <div className="kicker">{type}</div>
                  <h2>{TYPE_LABELS[type]}</h2>
                </div>
                <span className="chip">
                  {counts[type]} / {DECK_LIMITS[type]}
                </span>
              </div>

              <div className="deck-detail-grid">
                {getItemsByType(deck.items, type).map((item) => {
                  const imageUrl = getRepresentativeCardImageUrl(item.card, "list");
                  const cost = getCostLabel(item.card);
                  const activeCost = getActiveCostLabel(item.card);

                  return (
                    <a
                      aria-label={`${item.card.name} 상세 보기${item.isField ? ", 필드 카드" : ""}`}
                      className={item.isField ? "deck-detail-card field-card" : "deck-detail-card"}
                      data-card-type={type}
                      href={`/cards/${encodeURIComponent(item.card.collectionNumber)}`}
                      key={item.id}
                    >
                      <div className="card-image-frame">
                        <CardImage src={imageUrl} alt={item.card.name} />
                        <span className="deck-detail-cost-badge">{cost}</span>
                        {type !== "ACTIVE" ? <span className="deck-detail-active-cost-badge">{activeCost}</span> : null}
                        {item.isField ? <span className="deck-detail-field-badge">필드</span> : null}
                        {type === "ACTIVE" ? <span className="deck-detail-quantity-badge">×{item.quantity}</span> : null}
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Deck Builder</span>
        <span>{deck.id}</span>
      </footer>
    </>
  );
}
