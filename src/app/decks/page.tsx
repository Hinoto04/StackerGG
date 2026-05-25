import { CardImage } from "@/components/CardImage";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { getRepresentativeCardImageUrl } from "@/data/cards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DECK_PAGE_SIZE = 12;

type DeckListItem = Awaited<ReturnType<typeof getDecks>>["items"][number];

async function getDecks(query: string, requestedPage: number) {
  const keyword = query.trim();
  const where = keyword
    ? {
        name: {
          contains: keyword,
          mode: "insensitive" as const,
        },
      }
    : undefined;
  const total = await prisma.deck.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / DECK_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);

  const items = await prisma.deck.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (currentPage - 1) * DECK_PAGE_SIZE,
    take: DECK_PAGE_SIZE,
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
          OR: [{ isField: true }, { slotType: "MAIN" }],
        },
        orderBy: {
          displayOrder: "asc",
        },
        select: {
          id: true,
          slotType: true,
          displayOrder: true,
          isField: true,
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

  return {
    currentPage,
    items,
    pageSize: DECK_PAGE_SIZE,
    total,
    totalPages,
  };
}

function getPreviewItems(deck: DeckListItem) {
  const fieldItems = deck.items
    .filter((item) => item.isField)
    .sort((a, b) => {
      const typeOrder = (a.slotType === "MAIN" ? 0 : 1) - (b.slotType === "MAIN" ? 0 : 1);

      return typeOrder || a.displayOrder - b.displayOrder;
    })
    .slice(0, 4);

  if (fieldItems.length > 0) {
    return {
      items: fieldItems,
      isFieldPreview: true,
    };
  }

  return {
    items: deck.items.filter((item) => item.slotType === "MAIN").slice(0, 3),
    isFieldPreview: false,
  };
}

function DeckListCard({ deck }: { deck: DeckListItem }) {
  const authorLabel = deck.author.displayName || deck.author.loginId;
  const preview = getPreviewItems(deck);

  return (
    <article className="deck-list-card">
      <a className="deck-list-main" href={`/decks/${deck.id}`} aria-label={`${deck.name} 상세 보기`}>
        <div className="deck-list-body">
          <h2>{deck.name}</h2>
          <span>{authorLabel}</span>
        </div>

        <div className={preview.isFieldPreview ? "deck-list-preview field-preview" : "deck-list-preview"} aria-hidden="true">
          {preview.items.length > 0 ? (
            preview.items.map((item) => (
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

type DeckListPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
  }>;
};

function getQuery(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0]?.trim() ?? "" : value?.trim() ?? "";
}

function getPage(value: string | string[] | undefined) {
  const page = Number(getQuery(value));

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function buildDeckPageHref(query: string, page: number) {
  const searchParams = new URLSearchParams();

  if (query) {
    searchParams.set("q", query);
  }

  if (page > 1) {
    searchParams.set("page", String(page));
  }

  const queryString = searchParams.toString();

  return queryString ? `/decks?${queryString}` : "/decks";
}

export default async function DeckListPage({ searchParams }: DeckListPageProps) {
  const { page, q } = await searchParams;
  const query = getQuery(q);
  const { currentPage, items: decks, pageSize, total, totalPages } = await getDecks(query, getPage(page));
  const hasQuery = query.length > 0;
  const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, total);

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
            <span>{hasQuery ? `검색 ${total}개` : `총 ${total}개`}</span>
            {total > 0 ? <span>{`${pageStart}-${pageEnd}개 표시`}</span> : null}
            <a className="button primary-button" href="/decks/new">
              덱 작성
            </a>
          </div>
        </section>

        <section className="search-panel" aria-label="덱 검색">
          <form className="search-row simple-search-row" action="/decks" method="get">
            <label className="search-input">
              <span className="sr-only">덱 이름 검색</span>
              <input defaultValue={query} name="q" placeholder="덱 이름 검색" type="search" />
            </label>
            <button className="button primary-button" type="submit">
              검색
            </button>
            {hasQuery ? (
              <a className="button ghost-button" href="/decks">
                초기화
              </a>
            ) : null}
          </form>
        </section>

        {decks.length > 0 ? (
          <>
            <section className="deck-list-grid" aria-label="덱 목록">
              {decks.map((deck) => (
                <DeckListCard deck={deck} key={deck.id} />
              ))}
            </section>
            <Pagination currentPage={currentPage} totalPages={totalPages} getPageHref={(nextPage) => buildDeckPageHref(query, nextPage)} label="덱 목록 페이지" />
          </>
        ) : (
          <section className="empty-panel">
            <strong>{hasQuery ? "검색 결과가 없습니다." : "등록된 덱이 없습니다."}</strong>
            <p>{hasQuery ? "다른 덱 이름으로 검색해보세요." : "첫 덱을 작성하면 이곳에 표시됩니다."}</p>
            {hasQuery ? (
              <a className="button ghost-button" href="/decks">
                전체 덱 보기
              </a>
            ) : (
              <a className="button primary-button" href="/decks/new">
                덱 작성
              </a>
            )}
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
