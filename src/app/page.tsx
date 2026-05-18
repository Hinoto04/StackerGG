import { CardImage } from "@/components/CardImage";
import { cards, getRepresentativeCardImageUrl, type CardRecord } from "@/data/cards";

type SearchParams = Record<string, string | string[] | undefined>;

function getParam(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function filterCards(params: SearchParams) {
  const keyword = getParam(params, "keyword").trim().toLowerCase();

  if (!keyword) {
    return cards;
  }

  return cards.filter((card) => {
    const searchableText = [card.name, card.collectionNumber, card.cardType].join(" ").toLowerCase();

    return searchableText.includes(keyword);
  });
}

function CardTile({ card }: { card: CardRecord }) {
  const imageUrl = getRepresentativeCardImageUrl(card, "list");

  return (
    <article className="card-tile">
      <div className="card-image-frame">
        <CardImage src={imageUrl} alt={card.name} />
      </div>
      <div className="card-name">
        <strong>{card.name}</strong>
        <span>{card.collectionNumber}</span>
      </div>
    </article>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const keyword = getParam(params, "keyword");
  const filteredCards = filterCards(params);

  return (
    <>
      <header className="site-shell site-header">
        <a className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>
            <strong>StackerDB</strong>
            <small>Card Database</small>
          </span>
        </a>
        <nav className="main-nav" aria-label="주 메뉴">
          <a href="/">카드</a>
          <a href="/">덱</a>
          <a href="/">랭킹</a>
          <a href="/">가이드</a>
          <a href="/">멀티플레이</a>
        </nav>
        <div className="account-actions">
          <button type="button">라이트</button>
          <a href="/">로그인</a>
        </div>
      </header>

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">CARD DATABASE</div>
            <h1>카드 목록</h1>
            <p>목록 화면은 카드 이미지와 카드 이름만 보여주고, 상세 데이터는 모델에만 준비해둔 상태입니다.</p>
          </div>
          <div className="head-chips">
            <span>총 {cards.length}장</span>
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
        </form>

        {filteredCards.length > 0 ? (
          <section className="card-grid" aria-label="카드 목록">
            {filteredCards.map((card) => (
              <CardTile card={card} key={card.id} />
            ))}
          </section>
        ) : (
          <section className="empty-panel">
            <strong>검색 결과가 없습니다.</strong>
            <p>다른 카드 이름으로 검색해보세요.</p>
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
