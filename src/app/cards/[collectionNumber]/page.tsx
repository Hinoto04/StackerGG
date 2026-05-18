import { notFound } from "next/navigation";
import { CardImage } from "@/components/CardImage";
import { SiteHeader } from "@/components/SiteHeader";
import { compareRarities, DEFAULT_LIST_RARITY, getReleaseCardImageUrl, getRepresentativeCardRelease } from "@/data/cards";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteParams = {
  collectionNumber: string;
};

type ReleaseItem = {
  id: string;
  rarity: string;
  collectionNumber: string;
  pack: {
    codePrefix: string;
    name: string;
    releaseDate: Date;
  };
};

type ReleaseGroup = {
  collectionNumber: string;
  pack: ReleaseItem["pack"];
  releases: ReleaseItem[];
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getTypeName(cardType: string) {
  switch (cardType) {
    case "MAIN":
      return "메인 스태커";
    case "SUB":
      return "서브 스태커";
    case "ACTIVE":
      return "액티브 스태커";
    default:
      return cardType;
  }
}

function compareRelease(a: ReleaseItem, b: ReleaseItem) {
  return (
    a.pack.releaseDate.getTime() - b.pack.releaseDate.getTime() ||
    a.collectionNumber.localeCompare(b.collectionNumber) ||
    compareRarities(a.rarity, b.rarity)
  );
}

function getSortedReleases(releases: ReleaseItem[]) {
  return [...releases].sort(compareRelease);
}

function getReleaseGroups(releases: ReleaseItem[]) {
  const groups: ReleaseGroup[] = [];
  const groupMap = new Map<string, ReleaseGroup>();

  for (const release of getSortedReleases(releases)) {
    const existingGroup = groupMap.get(release.collectionNumber);

    if (existingGroup) {
      existingGroup.releases.push(release);
      continue;
    }

    const group = {
      collectionNumber: release.collectionNumber,
      pack: release.pack,
      releases: [release],
    };

    groups.push(group);
    groupMap.set(release.collectionNumber, group);
  }

  return groups.map((group) => ({
    ...group,
    releases: [...group.releases].sort((a, b) => compareRarities(a.rarity, b.rarity)),
  }));
}

function EffectBlock({
  title,
  cost,
  effect,
  tone,
}: {
  title: string;
  cost: string | null;
  effect: string | null;
  tone: "main" | "sub" | "active";
}) {
  if (!effect) {
    return null;
  }

  return (
    <section className={`effect-block effect-${tone}`}>
      <div className="effect-title-row">
        <h2>{title}</h2>
        <span>코스트 {cost || "0"}</span>
      </div>
      <p>{effect}</p>
    </section>
  );
}

async function getCard(collectionNumber: string) {
  return prisma.card.findUnique({
    where: { collectionNumber },
    include: {
      releases: {
        include: {
          pack: true,
        },
      },
    },
  });
}

export default async function CardDetailPage({ params }: { params: Promise<RouteParams> }) {
  const { collectionNumber } = await params;
  const card = await getCard(decodeURIComponent(collectionNumber));

  if (!card) {
    notFound();
  }

  const sortedReleases = getSortedReleases(card.releases);
  const releaseGroups = getReleaseGroups(card.releases);
  const representativeRelease = getRepresentativeCardRelease({
    collectionNumber: card.collectionNumber,
    releases: sortedReleases,
  });
  const representativeImageUrl = getReleaseCardImageUrl(representativeRelease, "detail");
  const user = await getCurrentUser();
  const admin = isAdmin(user);

  return (
    <>
      <SiteHeader active="cards" />

      <main className="site-shell content">
        <section className="detail-hero">
          <div className="detail-image-panel">
            <div className="detail-image-frame">
              <CardImage src={representativeImageUrl} alt={card.name} />
            </div>
          </div>

          <div className="detail-info">
            <div className="kicker">CARD DETAIL</div>
            <h1>{card.name}</h1>
            <div className="chip-row">
              <span className="chip">{card.collectionNumber}</span>
              <span className="chip">{getTypeName(card.cardType)}</span>
              <span className="chip">수록 {card.releases.length}종</span>
              {admin ? (
                <a className="chip" href={`/cards/${encodeURIComponent(card.collectionNumber)}/edit`}>
                  카드 수정
                </a>
              ) : null}
            </div>

            <div className="detail-stat-grid" aria-label="카드 기본 정보">
              <div>
                <span>카드 타입</span>
                <strong>{card.cardType}</strong>
              </div>
              <div>
                <span>파워</span>
                <strong>{card.power ?? "-"}</strong>
              </div>
              <div>
                <span>대표 레어도</span>
                <strong>{representativeRelease?.rarity ?? DEFAULT_LIST_RARITY}</strong>
              </div>
              <div>
                <span>수록 번호</span>
                <strong>{card.collectionNumber}</strong>
              </div>
            </div>

            <div className="effect-stack">
              <EffectBlock title="메인 효과" cost={card.mainCost} effect={card.mainEffect} tone="main" />
              <EffectBlock title="서브 효과" cost={card.subCost} effect={card.subEffect} tone="sub" />
              <EffectBlock title="액티브 효과" cost={card.activeCost} effect={card.activeEffect} tone="active" />
            </div>
          </div>
        </section>

        <section className="detail-section">
          <div className="section-heading">
            <div>
              <div className="kicker">RELEASES</div>
              <h2>수록 정보</h2>
            </div>
          </div>

          {card.releases.length > 0 ? (
            <div className="release-table" aria-label="수록 정보">
              {releaseGroups.map((group) => (
                <article className="release-row" key={group.collectionNumber}>
                  <div>
                    <strong>{group.pack.name}</strong>
                    <span>
                      {group.pack.codePrefix} · {formatDate(group.pack.releaseDate)}
                    </span>
                  </div>
                  <div className="chip-row">
                    <span className="chip">{group.collectionNumber}</span>
                    {group.releases.map((release) => (
                      <span className="chip rarity-chip" key={release.id}>
                        {release.rarity}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="empty-panel">
              <strong>수록 정보가 없습니다.</strong>
              <p>이 카드에 연결된 수록 레코드가 아직 없습니다.</p>
            </section>
          )}
        </section>

        {card.releases.length > 0 ? (
          <section className="detail-section">
            <div className="section-heading">
              <div>
                <div className="kicker">CARD IMAGES</div>
                <h2>레어도별 이미지</h2>
              </div>
            </div>

            <div className="release-image-grid">
              {sortedReleases.map((release) => (
                <article className="release-image-item" key={release.id}>
                  <div className="card-image-frame">
                    <CardImage src={getReleaseCardImageUrl(release, "list")} alt={`${card.name} ${release.rarity}`} />
                  </div>
                  <div>
                    <strong>{release.rarity}</strong>
                    <span>{release.collectionNumber}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Card Database</span>
        <span>{card.collectionNumber}</span>
      </footer>
    </>
  );
}
