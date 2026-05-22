"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { CardImage } from "@/components/CardImage";
import { CARD_TYPES, DEFAULT_LIST_RARITY, getAllowedRaritiesForCardType, getCardImageUrl } from "@/data/cards";
import { createCardAction, type CardFormField, type CardFormState } from "./actions";

interface PackOption {
  id: string;
  name: string;
  codePrefix: string;
  releaseDate: string;
}

interface CardCreateFormProps {
  packs: PackOption[];
}

const initialState: CardFormState = {
  status: "idle",
  message: "",
  fieldErrors: {},
};

function mergeUnique(values: string[]) {
  return Array.from(new Set(values));
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <span className="field-error" id={id}>
      {message}
    </span>
  );
}

function errorId(field: CardFormField) {
  return `${field}-error`;
}

export function CardCreateForm({ packs }: CardCreateFormProps) {
  const [state, formAction, pending] = useActionState(createCardAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [collectionNumber, setCollectionNumber] = useState("");
  const [cardType, setCardType] = useState("MAIN");
  const [selectedPackId, setSelectedPackId] = useState(packs[0]?.id ?? "");
  const [selectedRarities, setSelectedRarities] = useState<string[]>([DEFAULT_LIST_RARITY]);

  const selectedPack = packs.find((pack) => pack.id === selectedPackId);
  const rarityOptions = getAllowedRaritiesForCardType(cardType);
  const normalizedCollectionNumber = collectionNumber.trim().toUpperCase();
  const previewRarities = selectedRarities.filter((rarity) => rarityOptions.includes(rarity));
  const previewRarity = previewRarities[0] ?? DEFAULT_LIST_RARITY;
  const hasTypeSpecificEffect = cardType === "MAIN" || cardType === "SUB";
  const releaseSectionNumber = hasTypeSpecificEffect ? "04" : "03";
  const previewUrl = useMemo(() => {
    if (!normalizedCollectionNumber) {
      return "";
    }

    return getCardImageUrl(normalizedCollectionNumber, previewRarity, "detail");
  }, [normalizedCollectionNumber, previewRarity]);

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }

    formRef.current?.reset();
    setName("");
    setCollectionNumber("");
    setCardType("MAIN");
    setSelectedPackId(packs[0]?.id ?? "");
    setSelectedRarities([DEFAULT_LIST_RARITY]);
  }, [packs, state.createdCard?.collectionNumber, state.status]);

  useEffect(() => {
    const allowedRarities = getAllowedRaritiesForCardType(cardType);

    setSelectedRarities((current) => {
      const nextRarities = current.filter((rarity) => allowedRarities.includes(rarity));
      return nextRarities.length > 0 ? nextRarities : [DEFAULT_LIST_RARITY];
    });
  }, [cardType]);

  function toggleRarity(rarity: string, checked: boolean) {
    setSelectedRarities((current) => {
      if (checked) {
        return mergeUnique([...current, rarity]);
      }

      return current.filter((value) => value !== rarity);
    });
  }

  return (
    <div className="form-layout">
      <form className="form-panel" ref={formRef} action={formAction}>
        {state.message ? (
          <div className={`form-alert ${state.status === "success" ? "success-alert" : "error-alert"}`} role="status">
            <strong>{state.status === "success" ? "저장 완료" : "저장 실패"}</strong>
            <span>{state.message}</span>
          </div>
        ) : null}

        <div className="form-section">
          <div className="section-title">
            <span>01</span>
            <div>
              <h2>카드 기본 정보</h2>
              <p>목록과 상세 화면에서 공통으로 사용할 데이터입니다.</p>
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>카드명</span>
              <input
                aria-describedby={state.fieldErrors.name ? errorId("name") : undefined}
                name="name"
                onChange={(event) => setName(event.target.value)}
                placeholder="카드명을 입력"
                required
                type="text"
                value={name}
              />
              <FieldError id={errorId("name")} message={state.fieldErrors.name} />
            </label>

            <label className="field">
              <span>수록 번호</span>
              <input
                aria-describedby={state.fieldErrors.collectionNumber ? errorId("collectionNumber") : undefined}
                name="collectionNumber"
                onChange={(event) => setCollectionNumber(event.target.value.toUpperCase())}
                placeholder="BP01-KR001"
                required
                type="text"
                value={collectionNumber}
              />
              <FieldError id={errorId("collectionNumber")} message={state.fieldErrors.collectionNumber} />
            </label>

            <label className="field">
              <span>카드 타입</span>
              <select
                aria-describedby={state.fieldErrors.cardType ? errorId("cardType") : undefined}
                name="cardType"
                onChange={(event) => setCardType(event.target.value)}
                required
                value={cardType}
              >
                {CARD_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <FieldError id={errorId("cardType")} message={state.fieldErrors.cardType} />
            </label>

            <label className="field">
              <span>파워</span>
              <input
                aria-describedby={state.fieldErrors.power ? errorId("power") : undefined}
                inputMode="numeric"
                min="0"
                name="power"
                placeholder="없으면 비워두기"
                type="number"
              />
              <FieldError id={errorId("power")} message={state.fieldErrors.power} />
            </label>

            <label className="field wide-field">
              <span>카드 태그</span>
              <input
                aria-describedby={state.fieldErrors.tags ? errorId("tags") : undefined}
                name="tags"
                placeholder="예: A/B/C/"
                type="text"
              />
              <FieldError id={errorId("tags")} message={state.fieldErrors.tags} />
            </label>
          </div>

        </div>

        <div className="form-section">
          <div className="section-title">
            <span>02</span>
            <div>
              <h2>액티브 효과</h2>
              <p>모든 카드는 액티브 코스트와 액티브 효과를 가집니다.</p>
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>액티브 코스트</span>
              <input
                aria-describedby={state.fieldErrors.activeCost ? errorId("activeCost") : undefined}
                name="activeCost"
                placeholder="예: 1"
                required
                type="text"
              />
              <FieldError id={errorId("activeCost")} message={state.fieldErrors.activeCost} />
            </label>

            <label className="field wide-field">
              <span>액티브 효과</span>
              <textarea
                aria-describedby={state.fieldErrors.activeEffect ? errorId("activeEffect") : undefined}
                name="activeEffect"
                placeholder="액티브 효과 텍스트를 입력합니다. 줄바꿈은 그대로 저장됩니다."
                required
                rows={6}
              />
              <FieldError id={errorId("activeEffect")} message={state.fieldErrors.activeEffect} />
            </label>
          </div>
        </div>

        {hasTypeSpecificEffect ? (
          <div className="form-section">
            <div className="section-title">
              <span>03</span>
              <div>
                <h2>{cardType === "MAIN" ? "메인 효과" : "서브 효과"}</h2>
                <p>{cardType === "MAIN" ? "MAIN 카드는 메인 코스트와 메인 효과를 추가로 가집니다." : "SUB 카드는 서브 코스트와 서브 효과를 추가로 가집니다."}</p>
              </div>
            </div>

            <div className="field-grid">
              {cardType === "MAIN" ? (
                <>
                  <label className="field">
                    <span>메인 코스트</span>
                    <input
                      aria-describedby={state.fieldErrors.mainCost ? errorId("mainCost") : undefined}
                      name="mainCost"
                      placeholder="예: 2"
                      required
                      type="text"
                    />
                    <FieldError id={errorId("mainCost")} message={state.fieldErrors.mainCost} />
                  </label>

                  <label className="field wide-field">
                    <span>메인 효과</span>
                    <textarea
                      aria-describedby={state.fieldErrors.mainEffect ? errorId("mainEffect") : undefined}
                      name="mainEffect"
                      placeholder="메인 효과 텍스트를 입력합니다."
                      required
                      rows={6}
                    />
                    <FieldError id={errorId("mainEffect")} message={state.fieldErrors.mainEffect} />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>서브 코스트</span>
                    <input
                      aria-describedby={state.fieldErrors.subCost ? errorId("subCost") : undefined}
                      name="subCost"
                      placeholder="예: 1"
                      required
                      type="text"
                    />
                    <FieldError id={errorId("subCost")} message={state.fieldErrors.subCost} />
                  </label>

                  <label className="field wide-field">
                    <span>서브 효과</span>
                    <textarea
                      aria-describedby={state.fieldErrors.subEffect ? errorId("subEffect") : undefined}
                      name="subEffect"
                      placeholder="서브 효과 텍스트를 입력합니다."
                      required
                      rows={6}
                    />
                    <FieldError id={errorId("subEffect")} message={state.fieldErrors.subEffect} />
                  </label>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="form-section">
          <div className="section-title">
            <span>{releaseSectionNumber}</span>
            <div>
              <h2>수록 정보</h2>
              <p>선택한 팩에 같은 수록 번호로 들어가는 레어도들을 함께 등록합니다.</p>
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>수록 팩</span>
              <select
                aria-describedby={state.fieldErrors.packId ? errorId("packId") : undefined}
                disabled={packs.length === 0}
                name="packId"
                onChange={(event) => setSelectedPackId(event.target.value)}
                required
                value={selectedPackId}
              >
                {packs.length > 0 ? (
                  packs.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.codePrefix} · {pack.name}
                    </option>
                  ))
                ) : (
                  <option value="">등록된 팩 없음</option>
                )}
              </select>
              <FieldError id={errorId("packId")} message={state.fieldErrors.packId} />
            </label>

            <div className="field release-rule-panel">
              <span>레어도 규칙</span>
              <p>{cardType} 타입은 {rarityOptions.join(", ")} 레어도를 등록할 수 있습니다.</p>
            </div>
          </div>

          <div className="field wide-field">
            <span>수록 레어도</span>
            <div className="choice-group" aria-describedby={state.fieldErrors.rarities ? errorId("rarities") : undefined}>
              {rarityOptions.map((rarity) => (
                <label className="choice-pill" key={rarity}>
                  <input
                    checked={selectedRarities.includes(rarity)}
                    name="rarities"
                    onChange={(event) => toggleRarity(rarity, event.target.checked)}
                    type="checkbox"
                    value={rarity}
                  />
                  <span>{rarity}</span>
                </label>
              ))}
            </div>
            <FieldError id={errorId("rarities")} message={state.fieldErrors.rarities} />
          </div>
        </div>

        <div className="form-actions">
          <a className="button ghost-button" href="/">
            목록으로
          </a>
          <button className="button primary-button" disabled={pending || packs.length === 0} type="submit">
            {pending ? "저장 중" : "카드 등록"}
          </button>
        </div>
      </form>

      <aside className="preview-panel" aria-label="카드 미리보기">
        <div className="preview-image-frame">
          {previewUrl ? (
            <CardImage src={previewUrl} alt={name || normalizedCollectionNumber} />
          ) : (
            <div className="card-image-empty">
              <span>PREVIEW</span>
            </div>
          )}
        </div>
        <div className="preview-meta">
          <span>{normalizedCollectionNumber || "수록 번호"}</span>
          <h2>{name || "카드명"}</h2>
          <div className="chip-row">
            <span className="chip">{cardType || "타입"}</span>
            {previewRarities.length > 0
              ? previewRarities.map((rarity) => (
                  <span className="chip" key={rarity}>
                    {rarity}
                  </span>
                ))
              : null}
          </div>
          <p>{selectedPack ? `${selectedPack.codePrefix} · ${selectedPack.name} · ${selectedPack.releaseDate}` : "팩을 DB에 추가하면 선택할 수 있습니다."}</p>
        </div>
      </aside>
    </div>
  );
}
