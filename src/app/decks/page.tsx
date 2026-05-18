import { CardImage } from "@/components/CardImage";
import { SiteHeader } from "@/components/SiteHeader";
import { getRepresentativeCardImageUrl } from "@/data/cards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type DeckListItem = Awaited<ReturnType<typeof getDecks>>[number];

async function getDecks() {
  return prisma.deck.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      author: {
        select: {
          loginId: true,
          displayName: true,
        },
      },
      items: {
        where: {
          slotType: "MAIN",
        },
        orderBy: {
          displayOrder: "asc",
        },
        take: 3,
        select: {
          id: true,
          card: {
            select: {
              id: true,
              name: true,
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

function DeckListCard({ deck }: { deck: DeckListItem }) {
  const authorLabel = deck.author.displayName || deck.author.loginId;

  return (
    <article className="deck-list-card">
      <a className="deck-list-main" href={`/decks/${deck.id}`} aria-label={`${deck.name} 상세 보기`}>
        <div className="deck-list-body">
          <h2>{deck.name}</h2>
          <span>{authorLabel}</span>
        </div>

        <div className="deck-list-preview" aria-hidden="true">
          {deck.items.length > 0 ? (
            deck.items.map((item) => (
              <div className="deck-list-preview-card" key={item.id}>
                <CardImage src={getRepresentativeCardImageUrl(item.card, "list")} alt={item.card.name} />
              </div>
            ))
          ) : (
            <div className="deck-list-preview-empty">MAIN</div>
          )}
        </div>
      </a>
    </article>
  );
}

export default async function DeckListPage() {
  const decks = await getDecks();

  return (
    <>
      <SiteHeader active="decks" />

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">DECK LIST</div>
            <h1>덱 목록</h1>
            <p>등록된 스태커배틀 덱을 확인하고 상세 구성으로 이동합니다.</p>
          </div>
          <div className="head-chips">
            <span>총 {decks.length}개</span>
            <a className="button primary-button" href="/decks/new">
              덱 작성
            </a>
          </div>
        </section>

        {decks.length > 0 ? (
          <section className="deck-list-grid" aria-label="덱 목록">
            {decks.map((deck) => (
              <DeckListCard deck={deck} key={deck.id} />
            ))}
          </section>
        ) : (
          <section className="empty-panel">
            <strong>등록된 덱이 없습니다.</strong>
            <p>첫 덱을 작성하면 이곳에 표시됩니다.</p>
            <a className="button primary-button" href="/decks/new">
              덱 작성
            </a>
          </section>
        )}
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Deck List</span>
        <span>MAIN 3 / SUB 9 / ACTIVE 21</span>
      </footer>
    </>
  );
}
