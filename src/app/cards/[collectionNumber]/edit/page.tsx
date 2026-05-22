import { notFound } from "next/navigation";
import { updateCardAction } from "./actions";
import { SiteHeader } from "@/components/SiteHeader";
import { CARD_TYPES } from "@/data/cards";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteParams = {
  collectionNumber: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

export const dynamic = "force-dynamic";

function getParam(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function getCard(collectionNumber: string) {
  return prisma.card.findUnique({
    where: { collectionNumber },
  });
}

export default async function EditCardPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams?: Promise<SearchParams>;
}) {
  await requireAdmin();
  const { collectionNumber } = await params;
  const query = searchParams ? await searchParams : {};
  const card = await getCard(decodeURIComponent(collectionNumber));

  if (!card) {
    notFound();
  }

  const error = getParam(query, "error");

  return (
    <>
      <SiteHeader active="cards" />
      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">ADMIN</div>
            <h1>카드 수정</h1>
            <p>카드 기본 데이터와 효과 정보를 수정합니다. 수록 정보는 별도 관리 대상입니다.</p>
          </div>
          <div className="head-chips">
            <a className="button ghost-button" href={`/cards/${encodeURIComponent(card.collectionNumber)}`}>
              상세 보기
            </a>
          </div>
        </section>

        <form className="form-panel" action={updateCardAction}>
          {error ? (
            <div className="form-alert error-alert" role="status">
              <strong>수정 실패</strong>
              <span>입력값을 확인해주세요.</span>
            </div>
          ) : null}

          <input name="id" type="hidden" value={card.id} />

          <div className="field-grid">
            <label className="field">
              <span>카드명</span>
              <input name="name" required type="text" defaultValue={card.name} />
            </label>
            <label className="field">
              <span>수록 번호</span>
              <input name="collectionNumber" required type="text" defaultValue={card.collectionNumber} />
            </label>
            <label className="field">
              <span>카드 타입</span>
              <select name="cardType" required defaultValue={card.cardType}>
                {CARD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>파워</span>
              <input min="0" name="power" type="number" defaultValue={card.power ?? ""} />
            </label>
            <label className="field wide-field">
              <span>카드 태그</span>
              <input name="tags" placeholder="예: A/B/C/" type="text" defaultValue={card.tags} />
            </label>
            <label className="field">
              <span>액티브 코스트</span>
              <input name="activeCost" required type="text" defaultValue={card.activeCost} />
            </label>
            <label className="field wide-field">
              <span>액티브 효과</span>
              <textarea name="activeEffect" required rows={6} defaultValue={card.activeEffect} />
            </label>
            <label className="field">
              <span>메인 코스트</span>
              <input name="mainCost" type="text" defaultValue={card.mainCost ?? ""} />
            </label>
            <label className="field wide-field">
              <span>메인 효과</span>
              <textarea name="mainEffect" rows={6} defaultValue={card.mainEffect ?? ""} />
            </label>
            <label className="field">
              <span>서브 코스트</span>
              <input name="subCost" type="text" defaultValue={card.subCost ?? ""} />
            </label>
            <label className="field wide-field">
              <span>서브 효과</span>
              <textarea name="subEffect" rows={6} defaultValue={card.subEffect ?? ""} />
            </label>
          </div>

          <div className="form-actions">
            <a className="button ghost-button" href={`/cards/${encodeURIComponent(card.collectionNumber)}`}>
              취소
            </a>
            <button className="button primary-button" type="submit">
              저장
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
