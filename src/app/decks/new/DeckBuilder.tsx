"use client";

import { useActionState, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { CardImage } from "@/components/CardImage";
import { CARD_TYPES, getRepresentativeCardImageUrl, type CardType } from "@/data/cards";
import { createDeckAction, type DeckFormField, type DeckFormState } from "./actions";

type BuilderCardRelease = {
  collectionNumber: string;
  rarity: string;
};

export type BuilderCard = {
  id: string;
  name: string;
  cardType: CardType;
  power: number | null;
  activeCost: string;
  mainCost: string | null;
  subCost: string | null;
  collectionNumber: string;
  tags: string;
  releases: BuilderCardRelease[];
};

export type DeckItem = {
  cardId: string;
  slotType: CardType;
  quantity: number;
  isField: boolean;
};

type DeckAction = (previousState: DeckFormState, formData: FormData) => Promise<DeckFormState>;

type DeckBuilderProps = {
  action?: DeckAction;
  cards: BuilderCard[];
  failureTitle?: string;
  initialDescription?: string;
  initialItems?: DeckItem[];
  initialName?: string;
  pendingLabel?: string;
  submitLabel?: string;
};

const DECK_LIMITS: Record<CardType, number> = {
  MAIN: 3,
  SUB: 9,
  ACTIVE: 21,
};

const FIELD_LIMITS: Record<CardType, number> = {
  MAIN: 1,
  SUB: 3,
  ACTIVE: 0,
};

const TYPE_LABELS: Record<CardType, string> = {
  MAIN: "메인",
  SUB: "서브",
  ACTIVE: "액티브",
};

const initialState: DeckFormState = {
  status: "idle",
  message: "",
  fieldErrors: {},
};

function getCardCost(card: BuilderCard) {
  if (card.cardType === "MAIN") {
    return card.mainCost || "";
  }

  if (card.cardType === "SUB") {
    return card.subCost || "";
  }

  return card.activeCost || "";
}

function getCardCostLabel(card: BuilderCard) {
  return getCardCost(card).trim() || "0";
}

function getActiveCostLabel(card: BuilderCard) {
  return card.activeCost.trim() || "0";
}

function getCostRank(card: BuilderCard) {
  const cost = getCardCostLabel(card);
  const numericCost = Number(cost);

  if (Number.isFinite(numericCost)) {
    return {
      bucket: 0,
      number: numericCost,
      text: cost,
    };
  }

  return {
    bucket: 1,
    number: 0,
    text: cost,
  };
}

function compareCardsByCostThenName(a: BuilderCard, b: BuilderCard) {
  const aRank = getCostRank(a);
  const bRank = getCostRank(b);

  return (
    CARD_TYPES.indexOf(a.cardType) - CARD_TYPES.indexOf(b.cardType) ||
    aRank.bucket - bRank.bucket ||
    aRank.number - bRank.number ||
    aRank.text.localeCompare(bRank.text) ||
    a.name.localeCompare(b.name, "ko-KR") ||
    a.collectionNumber.localeCompare(b.collectionNumber)
  );
}

function compareDeckItemsByCard(a: DeckItem, b: DeckItem, cardsById: Map<string, BuilderCard>) {
  const aCard = cardsById.get(a.cardId);
  const bCard = cardsById.get(b.cardId);

  if (!aCard || !bCard) {
    return 0;
  }

  return compareCardsByCostThenName(aCard, bCard);
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

function errorId(field: DeckFormField) {
  return `${field}-error`;
}

function getEmptyCounts(): Record<CardType, number> {
  return {
    MAIN: 0,
    SUB: 0,
    ACTIVE: 0,
  };
}

function normalizeInitialItems(items: DeckItem[]) {
  return items.map((item) => ({
    ...item,
    isField: item.slotType === "ACTIVE" ? false : Boolean(item.isField),
  }));
}

export function DeckBuilder({
  action = createDeckAction,
  cards,
  failureTitle = "저장 실패",
  initialDescription = "",
  initialItems = [],
  initialName = "",
  pendingLabel = "저장 중",
  submitLabel = "덱 저장",
}: DeckBuilderProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [name, setName] = useState(initialName);
  const [keyword, setKeyword] = useState("");
  const [cardTypeFilter, setCardTypeFilter] = useState<CardType | "">("");
  const [costFilter, setCostFilter] = useState("");
  const [powerFilter, setPowerFilter] = useState("");
  const [deckItems, setDeckItems] = useState<DeckItem[]>(() => normalizeInitialItems(initialItems));
  const [dragCardId, setDragCardId] = useState<string | null>(null);

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const costs = useMemo(() => Array.from(new Set(cards.map(getCardCost).filter(Boolean))).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)), [cards]);
  const powers = useMemo(
    () => Array.from(new Set(cards.map((card) => card.power).filter((power): power is number => power !== null))).sort((a, b) => a - b),
    [cards],
  );
  const counts = useMemo(() => {
    const nextCounts = getEmptyCounts();

    for (const item of deckItems) {
      nextCounts[item.slotType] += item.quantity;
    }

    return nextCounts;
  }, [deckItems]);
  const fieldCounts = useMemo(() => {
    const nextCounts = getEmptyCounts();

    for (const item of deckItems) {
      if (item.isField) {
        nextCounts[item.slotType] += 1;
      }
    }

    return nextCounts;
  }, [deckItems]);
  const filteredCards = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return cards
      .filter((card) => {
        if (normalizedKeyword) {
          const text = [card.name, card.collectionNumber, card.cardType, card.tags].join(" ").toLowerCase();

          if (!text.includes(normalizedKeyword)) {
            return false;
          }
        }

        if (cardTypeFilter && card.cardType !== cardTypeFilter) {
          return false;
        }

        if (costFilter && getCardCost(card) !== costFilter) {
          return false;
        }

        if (powerFilter && String(card.power ?? "") !== powerFilter) {
          return false;
        }

        return true;
      })
      .sort(compareCardsByCostThenName);
  }, [cardTypeFilter, cards, costFilter, keyword, powerFilter]);

  const isDeckComplete = CARD_TYPES.every((type) => counts[type] === DECK_LIMITS[type]);
  const canSubmit = name.trim().length > 0 && isDeckComplete;
  const serializedItems = JSON.stringify(deckItems);

  function getSelectedQuantity(cardId: string) {
    return deckItems.find((item) => item.cardId === cardId)?.quantity ?? 0;
  }

  function canAddCard(card: BuilderCard) {
    const selectedQuantity = getSelectedQuantity(card.id);

    if (card.cardType === "ACTIVE") {
      return selectedQuantity < 3 && counts.ACTIVE < DECK_LIMITS.ACTIVE;
    }

    return selectedQuantity === 0 && counts[card.cardType] < DECK_LIMITS[card.cardType];
  }

  function addCard(card: BuilderCard) {
    if (!canAddCard(card)) {
      return;
    }

    setDeckItems((current) => {
      const existingItem = current.find((item) => item.cardId === card.id);

      if (existingItem) {
        return current.map((item) => (item.cardId === card.id ? { ...item, quantity: item.quantity + 1 } : item));
      }

      return [...current, { cardId: card.id, slotType: card.cardType, quantity: 1, isField: false }];
    });
  }

  function getDraggedCard(event: DragEvent<HTMLElement>) {
    const cardId = event.dataTransfer.getData("application/x-stacker-card-id") || event.dataTransfer.getData("text/plain") || dragCardId;

    return cardId ? cardsById.get(cardId) ?? null : null;
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, card: BuilderCard) {
    if (!canAddCard(card)) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-stacker-card-id", card.id);
    event.dataTransfer.setData("text/plain", card.id);
    setDragCardId(card.id);
  }

  function handleDragOver(event: DragEvent<HTMLElement>, type?: CardType) {
    const card = dragCardId ? cardsById.get(dragCardId) : null;

    if (!card || (type && card.cardType !== type) || !canAddCard(card)) {
      event.dataTransfer.dropEffect = "none";
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent<HTMLElement>, type?: CardType) {
    event.preventDefault();
    event.stopPropagation();

    const card = getDraggedCard(event);

    if (card && (!type || card.cardType === type)) {
      addCard(card);
    }

    setDragCardId(null);
  }

  function getDropClass(type?: CardType) {
    const card = dragCardId ? cardsById.get(dragCardId) : null;

    if (!card) {
      return "";
    }

    if ((type && card.cardType !== type) || !canAddCard(card)) {
      return "drop-blocked";
    }

    return "drop-ready";
  }

  function removeOne(cardId: string) {
    setDeckItems((current) =>
      current.flatMap((item) => {
        if (item.cardId !== cardId) {
          return [item];
        }

        if (item.quantity <= 1) {
          return [];
        }

        return [{ ...item, quantity: item.quantity - 1 }];
      }),
    );
  }

  function removeAll(cardId: string) {
    setDeckItems((current) => current.filter((item) => item.cardId !== cardId));
  }

  function toggleFieldCard(cardId: string) {
    const target = deckItems.find((item) => item.cardId === cardId);

    if (!target || target.slotType === "ACTIVE") {
      return;
    }

    setDeckItems((current) => {
      if (target.slotType === "MAIN") {
        return current.map((item) => {
          if (item.slotType !== "MAIN") {
            return item;
          }

          if (item.cardId === cardId) {
            return { ...item, isField: !item.isField };
          }

          return { ...item, isField: false };
        });
      }

      const selectedSubCount = current.filter((item) => item.slotType === "SUB" && item.isField).length;

      return current.map((item) => {
        if (item.cardId !== cardId) {
          return item;
        }

        if (!item.isField && selectedSubCount >= FIELD_LIMITS.SUB) {
          return item;
        }

        return { ...item, isField: !item.isField };
      });
    });
  }

  function handleSelectedCardKeyDown(event: KeyboardEvent<HTMLElement>, item: DeckItem) {
    if (event.currentTarget !== event.target) {
      return;
    }

    if (item.slotType === "ACTIVE") {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleFieldCard(item.cardId);
    }
  }

  function resetDeck() {
    setDeckItems([]);
  }

  function getItemsByType(type: CardType) {
    return deckItems.filter((item) => item.slotType === type).sort((a, b) => compareDeckItemsByCard(a, b, cardsById));
  }

  return (
    <form className="deck-builder" action={formAction}>
      {state.message ? (
        <div className="form-alert error-alert" role="status">
          <strong>{failureTitle}</strong>
          <span>{state.message}</span>
        </div>
      ) : null}

      <section className="deck-meta-panel">
        <div className="field-grid">
          <label className="field">
            <span>덱 이름</span>
            <input
              aria-describedby={state.fieldErrors.name ? errorId("name") : undefined}
              name="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="덱 이름"
              required
              type="text"
              value={name}
            />
            <FieldError id={errorId("name")} message={state.fieldErrors.name} />
          </label>

          <label className="field wide-field">
            <span>설명</span>
            <textarea defaultValue={initialDescription} name="description" placeholder="덱 설명 또는 메모" rows={4} />
          </label>
        </div>
      </section>

      <input name="items" type="hidden" value={serializedItems} />

      <div className="deck-builder-layout">
        <section className="deck-library-panel">
          <div className="section-heading">
            <div>
              <div className="kicker">CARD POOL</div>
              <h2>카드 선택</h2>
            </div>
            <span className="chip">{filteredCards.length}장</span>
          </div>

          <div className="deck-toolbar">
            <label className="search-input">
              <span className="sr-only">카드 검색</span>
              <input onChange={(event) => setKeyword(event.target.value)} placeholder="카드명, 수록 번호, 태그 검색" type="search" value={keyword} />
            </label>
            <select onChange={(event) => setCardTypeFilter(event.target.value as CardType | "")} value={cardTypeFilter}>
              <option value="">전체 타입</option>
              {CARD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select onChange={(event) => setCostFilter(event.target.value)} value={costFilter}>
              <option value="">전체 코스트</option>
              {costs.map((cost) => (
                <option key={cost} value={cost}>
                  {cost}
                </option>
              ))}
            </select>
            <select onChange={(event) => setPowerFilter(event.target.value)} value={powerFilter}>
              <option value="">전체 파워</option>
              {powers.map((power) => (
                <option key={power} value={power}>
                  {power}
                </option>
              ))}
            </select>
          </div>

          <div className="deck-card-list" aria-label="검색된 카드">
            {filteredCards.map((card) => {
              const imageUrl = getRepresentativeCardImageUrl(card, "list");
              const cost = getCardCostLabel(card);
              const activeCost = getActiveCostLabel(card);

              return (
                <button
                  aria-label={`${card.name} 덱에 추가`}
                  className="deck-card-option"
                  disabled={!canAddCard(card)}
                  draggable={canAddCard(card)}
                  key={card.id}
                  onClick={() => addCard(card)}
                  onDragEnd={() => setDragCardId(null)}
                  onDragStart={(event) => handleDragStart(event, card)}
                  type="button"
                >
                  <div className="deck-card-thumb" data-card-type={card.cardType}>
                    <CardImage src={imageUrl} alt={card.name} />
                    <span className="deck-builder-cost-badge">{cost}</span>
                    {card.cardType !== "ACTIVE" ? <span className="deck-builder-active-cost-badge">{activeCost}</span> : null}
                  </div>
                  <strong>{card.name}</strong>
                </button>
              );
            })}
          </div>
        </section>

        <aside
          className={`deck-summary-panel ${getDropClass()}`}
          onDragOver={(event) => handleDragOver(event)}
          onDrop={(event) => handleDrop(event)}
        >
          <div className="section-heading">
            <div>
              <div className="kicker">DECK</div>
              <h2>덱 구성</h2>
            </div>
            <button className="button ghost-button" onClick={resetDeck} type="button">
              비우기
            </button>
          </div>

          <div className="deck-count-grid">
            {CARD_TYPES.map((type) => (
              <div className={counts[type] === DECK_LIMITS[type] ? "deck-count-card complete" : "deck-count-card"} key={type}>
                <span>{TYPE_LABELS[type]}</span>
                <strong>
                  {counts[type]} / {DECK_LIMITS[type]}
                </strong>
              </div>
            ))}
          </div>

          <FieldError id={errorId("items")} message={state.fieldErrors.items} />

          {CARD_TYPES.map((type) => (
            <section
              className={`deck-section ${getDropClass()}`}
              key={type}
              onDragOver={(event) => handleDragOver(event)}
              onDrop={(event) => handleDrop(event)}
            >
              <div className="deck-section-head">
                <h3>{TYPE_LABELS[type]}</h3>
                <span>
                  {counts[type]} / {DECK_LIMITS[type]}
                  {FIELD_LIMITS[type] > 0 ? ` · 필드 ${fieldCounts[type]} / ${FIELD_LIMITS[type]}` : ""}
                </span>
              </div>
              <div className="deck-selected-list">
                {getItemsByType(type).length > 0 ? (
                  getItemsByType(type).map((item) => {
                    const card = cardsById.get(item.cardId);

                    if (!card) {
                      return null;
                    }

                    const canToggleField = item.slotType !== "ACTIVE";
                    const selectedCardClass = item.isField ? "deck-selected-card field-card" : "deck-selected-card";
                    const cost = getCardCostLabel(card);
                    const activeCost = getActiveCostLabel(card);

                    return (
                      <article
                        aria-pressed={canToggleField ? item.isField : undefined}
                        className={selectedCardClass}
                        key={item.cardId}
                        onClick={canToggleField ? () => toggleFieldCard(item.cardId) : undefined}
                        onKeyDown={canToggleField ? (event) => handleSelectedCardKeyDown(event, item) : undefined}
                        role={canToggleField ? "button" : undefined}
                        tabIndex={canToggleField ? 0 : undefined}
                      >
                        <div className="deck-selected-thumb" data-card-type={card.cardType}>
                          <CardImage src={getRepresentativeCardImageUrl(card, "list")} alt={card.name} />
                          <span className="deck-builder-cost-badge">{cost}</span>
                          {card.cardType !== "ACTIVE" ? <span className="deck-builder-active-cost-badge">{activeCost}</span> : null}
                          {item.quantity > 1 ? <span className="deck-quantity-badge">×{item.quantity}</span> : null}
                          {item.isField ? <span className="deck-field-badge">필드</span> : null}
                        </div>
                        <div className="deck-selected-info">
                          <strong>{card.name}</strong>
                        </div>
                        {item.slotType === "ACTIVE" ? (
                          <div className="quantity-controls" onClick={(event) => event.stopPropagation()}>
                            <button aria-label={`${card.name} 1장 제거`} onClick={() => removeOne(item.cardId)} type="button">
                              -
                            </button>
                            <button aria-label={`${card.name} 1장 추가`} disabled={!canAddCard(card)} onClick={() => addCard(card)} type="button">
                              +
                            </button>
                            <button aria-label={`${card.name} 모두 제거`} onClick={() => removeAll(item.cardId)} type="button">
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            className="deck-remove-button"
                            aria-label={`${card.name} 제거`}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeAll(item.cardId);
                            }}
                            type="button"
                          >
                            ×
                          </button>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <p>선택된 카드가 없습니다.</p>
                )}
              </div>
            </section>
          ))}

          <div className="deck-submit-panel">
            <button className="button primary-button" disabled={!canSubmit || pending} type="submit">
              {pending ? pendingLabel : submitLabel}
            </button>
          </div>
        </aside>
      </div>
    </form>
  );
}
