import { CardImage } from "@/components/CardImage";
import { SiteHeader } from "@/components/SiteHeader";
import { CARD_TYPES, getRepresentativeCardImageUrl, type CardRecord, type CardReleaseRecord } from "@/data/cards";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type SearchParams = Record<string, string | string[] | undefined>;
type CardListRelease = Pick<CardReleaseRecord, "collectionNumber" | "rarity">;
type CardListItem = Pick<CardRecord, "id" | "name" | "collectionNumber"> & {
  releases: CardListRelease[];
};
type SortKey = "collectionNumber" | "cost" | "power" | "releaseDate";
type SortDirection = "asc" | "desc";

interface CardQueryRelease extends CardListRelease {
  pack: {
    releaseDate: Date;
  };
}

interface CardQueryItem extends Omit<CardListItem, "releases"> {
  activeCost: string;
  mainCost: string | null;
  subCost: string | null;
  power: number | null;
  cardType: string;
  releases: CardQueryRelease[];
}

export const dynamic = "force-dynamic";

function getParam(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function getSortKey(params: SearchParams): SortKey {
  const value = getParam(params, "sort");
  return value === "cost" || value === "power" || value === "releaseDate" ? value : "collectionNumber";
}

function getSortDirection(params: SearchParams): SortDirection {
  return getParam(params, "direction") === "desc" ? "desc" : "asc";
}

function toNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPrimaryCost(card: CardQueryItem) {
  if (card.cardType === "MAIN") {
    return toNumber(card.mainCost);
  }

  if (card.cardType === "SUB") {
    return toNumber(card.subCost);
  }

  return toNumber(card.activeCost);
}

function getFirstReleaseTime(card: CardQueryItem) {
  const releaseTimes = card.releases.map((release) => release.pack.releaseDate.getTime());
  return releaseTimes.length > 0 ? Math.min(...releaseTimes) : null;
}

function compareNullableNumber(a: number | null, b: number | null, direction: SortDirection) {
  if (a === null && b === null) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return direction === "asc" ? a - b : b - a;
}

function sortCards(items: CardQueryItem[], sort: SortKey, direction: SortDirection) {
  return [...items].sort((a, b) => {
    let result = 0;

    if (sort === "cost") {
      result = compareNullableNumber(getPrimaryCost(a), getPrimaryCost(b), direction);
    } else if (sort === "power") {
      result = compareNullableNumber(a.power, b.power, direction);
    } else if (sort === "releaseDate") {
      result = compareNullableNumber(getFirstReleaseTime(a), getFirstReleaseTime(b), direction);
    } else {
      result = direction === "asc" ? a.collectionNumber.localeCompare(b.collectionNumber) : b.collectionNumber.localeCompare(a.collectionNumber);
    }

    return result || a.collectionNumber.localeCompare(b.collectionNumber) || a.name.localeCompare(b.name);
  });
}

async function getCards(params: SearchParams) {
  const keyword = getParam(params, "keyword").trim();
  const cardType = getParam(params, "cardType").trim().toUpperCase();
  const cost = getParam(params, "cost").trim();
  const packId = getParam(params, "packId").trim();
  const power = getParam(params, "power").trim();
  const sort = getSortKey(params);
  const direction = getSortDirection(params);
  const and: Prisma.CardWhereInput[] = [];

  if (keyword) {
    and.push({
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { collectionNumber: { contains: keyword, mode: "insensitive" } },
        { cardType: { contains: keyword, mode: "insensitive" } },
      ],
    });
  }

  if (CARD_TYPES.includes(cardType as (typeof CARD_TYPES)[number])) {
    and.push({ cardType });
  }

  if (cost) {
    and.push({
      OR: [{ activeCost: cost }, { mainCost: cost }, { subCost: cost }],
    });
  }

  if (packId) {
    and.push({
      releases: {
        some: {
          packId,
        },
      },
    });
  }

  const parsedPower = Number(power);
  if (power && Number.isInteger(parsedPower)) {
    and.push({ power: parsedPower });
  }

  const where: Prisma.CardWhereInput = and.length > 0 ? { AND: and } : {};

  const [items, total] = await Promise.all([
    prisma.card.findMany({
      where,
      select: {
        id: true,
        name: true,
        collectionNumber: true,
        cardType: true,
        power: true,
        activeCost: true,
        mainCost: true,
        subCost: true,
        releases: {
          select: {
            collectionNumber: true,
            rarity: true,
            pack: {
              select: {
                releaseDate: true,
              },
            },
          },
        },
      },
    }),
    prisma.card.count(),
  ]);

  return {
    items: sortCards(items, sort, direction),
    total,
  };
}

async function getFilterOptions() {
  const [packs, cards] = await Promise.all([
    prisma.pack.findMany({
      orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        codePrefix: true,
      },
    }),
    prisma.card.findMany({
      select: {
        power: true,
        activeCost: true,
        mainCost: true,
        subCost: true,
      },
    }),
  ]);

  const powers = Array.from(new Set(cards.map((card) => card.power).filter((power): power is number => power !== null))).sort((a, b) => a - b);
  const costs = Array.from(new Set(cards.flatMap((card) => [card.activeCost, card.mainCost, card.subCost]).filter((cost): cost is string => Boolean(cost)))).sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  );

  return { packs, powers, costs };
}

function CardTile({ card }: { card: CardListItem }) {
  const imageUrl = getRepresentativeCardImageUrl(card, "list");
  const detailUrl = `/cards/${encodeURIComponent(card.collectionNumber)}`;

  return (
    <a className="card-tile" href={detailUrl} aria-label={`${card.name} 상세 보기`}>
      <div className="card-image-frame">
        <CardImage src={imageUrl} alt={card.name} />
      </div>
    </a>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const keyword = getParam(params, "keyword");
  const selectedCardType = getParam(params, "cardType").trim().toUpperCase();
  const selectedCost = getParam(params, "cost").trim();
  const selectedPackId = getParam(params, "packId").trim();
  const selectedPower = getParam(params, "power").trim();
  const selectedSort = getSortKey(params);
  const selectedDirection = getSortDirection(params);
  const [{ items: filteredCards, total }, { packs, powers, costs }] = await Promise.all([getCards(params), getFilterOptions()]);

  return (
    <>
      <SiteHeader active="cards" />

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">CARD DATABASE</div>
            <h1>카드 목록</h1>
            <p>카드를 선택하면 코스트, 효과, 수록 팩, 레어도 정보를 상세히 확인할 수 있습니다.</p>
          </div>
          <div className="head-chips">
            <span>총 {total}장</span>
            <span>검색 결과 {filteredCards.length}장</span>
          </div>
        </section>

        <form className="search-panel" action="/" method="get">
          <div className="search-row simple-search-row">
            <label className="search-input">
              <span className="sr-only">카드 이름 검색</span>
              <input type="search" name="keyword" placeholder="카드 이름, 수록 번호 검색" defaultValue={keyword} />
            </label>
            <button className="button primary-button" type="submit">
              검색
            </button>
            <a className="button ghost-button" href="/">
              초기화
            </a>
          </div>
          <div className="filter-grid">
            <label className="filter-field">
              <span>타입</span>
              <select name="cardType" defaultValue={selectedCardType}>
                <option value="">전체</option>
                {CARD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>코스트</span>
              <select name="cost" defaultValue={selectedCost}>
                <option value="">전체</option>
                {costs.map((cost) => (
                  <option key={cost} value={cost}>
                    {cost}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>수록 팩</span>
              <select name="packId" defaultValue={selectedPackId}>
                <option value="">전체</option>
                {packs.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.codePrefix} · {pack.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>파워</span>
              <select name="power" defaultValue={selectedPower}>
                <option value="">전체</option>
                {powers.map((power) => (
                  <option key={power} value={power}>
                    {power}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>정렬</span>
              <select name="sort" defaultValue={selectedSort}>
                <option value="collectionNumber">수록 번호</option>
                <option value="releaseDate">출시순</option>
                <option value="cost">코스트</option>
                <option value="power">파워</option>
              </select>
            </label>

            <label className="filter-field">
              <span>방향</span>
              <select name="direction" defaultValue={selectedDirection}>
                <option value="asc">오름차순</option>
                <option value="desc">내림차순</option>
              </select>
            </label>
          </div>
        </form>

        {filteredCards.length > 0 ? (
          <section className="card-grid" aria-label="카드 목록">
            {filteredCards.map((card) => (
              <CardTile card={card} key={card.id} />
            ))}
          </section>
        ) : (
          <section className="empty-panel">
            <strong>{keyword ? "검색 결과가 없습니다." : "등록된 카드가 없습니다."}</strong>
            <p>{keyword ? "다른 카드 이름이나 수록 번호로 검색해보세요." : "DB에 카드 데이터를 추가하면 이곳에 표시됩니다."}</p>
            <a className="button primary-button" href="/">
              전체 카드 보기
            </a>
          </section>
        )}
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Card Database</span>
        <span>Card image and name first. Details can be added after the card system is defined.</span>
      </footer>
    </>
  );
}
