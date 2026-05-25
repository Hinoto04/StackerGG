"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import { CardImage } from "@/components/CardImage";
import { compileEffectText, type EffectAction, type EffectCardFilter, type EffectChoiceAction, type EffectInputAction } from "@/game/effectEngine";

export type SimulatorZoneId = "deck" | "hand" | "stack" | "trash" | "mainField" | "subField1" | "subField2" | "subField3";

export type SimulatorCard = {
  id: string;
  cardId: string;
  name: string;
  cardType: string;
  power: number | null;
  activeCost: string;
  activeEffect: string;
  mainCost: string | null;
  mainEffect: string | null;
  subCost: string | null;
  subEffect: string | null;
  collectionNumber: string;
  imageUrl: string;
  initialZone: SimulatorZoneId;
};

type SimulatorBoardProps = {
  cards: SimulatorCard[];
  initialShuffleSeed: string;
  opponentLifeDefault: number;
};

type ZoneState = Record<SimulatorZoneId, SimulatorCard[]>;
type DeckPlacement = "top" | "bottom";
type DropTarget = SimulatorZoneId | "deck-bottom";
type PileModalSource = "deck" | "trash";
type BatchMoveState = {
  source: SimulatorZoneId;
  count: number;
  x: number;
  y: number;
};
type CardVisualState = {
  faceDown: boolean;
  rotated: boolean;
};
type OverlapLayout = {
  cardSize: number;
  step: number;
};
type PendingEffectChoice = EffectChoiceAction & {
  label: string;
  remainingActions: EffectAction[];
  selectedIds: string[];
  candidateIds?: string[];
};
type PendingEffectInput = EffectInputAction & {
  label: string;
  remainingActions: EffectAction[];
  value: string;
};
type EffectKind = "active" | "main" | "sub";
type EffectRunnerEntry = {
  label: string;
  text: string | null;
  cost: string | null;
  kind: EffectKind;
};

const INITIAL_HAND_SIZE = 4;

const FIELD_ZONE_TYPES: Partial<Record<SimulatorZoneId, string>> = {
  mainField: "MAIN",
  subField1: "SUB",
  subField2: "SUB",
  subField3: "SUB",
};

function createEmptyZones(): ZoneState {
  return {
    deck: [],
    hand: [],
    stack: [],
    trash: [],
    mainField: [],
    subField1: [],
    subField2: [],
    subField3: [],
  };
}

function createInitialZones(cards: SimulatorCard[], deckShuffler: (cardsToShuffle: SimulatorCard[]) => SimulatorCard[]) {
  const zones = createEmptyZones();

  for (const card of cards) {
    zones[card.initialZone].push(card);
  }

  zones.deck = deckShuffler(zones.deck);
  const openingHand = zones.deck.splice(0, INITIAL_HAND_SIZE);
  zones.hand.push(...openingHand);

  return zones;
}

function createInitialCardVisualStates(cards: SimulatorCard[]) {
  return cards.reduce<Record<string, CardVisualState>>((states, card) => {
    states[card.id] = {
      faceDown: card.initialZone.startsWith("subField"),
      rotated: false,
    };

    return states;
  }, {});
}

function shuffleCards(cards: SimulatorCard[]) {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function getSeedNumber(seed: string) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed: string) {
  let value = getSeedNumber(seed);

  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);

    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleCardsWithSeed(cards: SimulatorCard[], seed: string) {
  const random = createSeededRandom(seed);
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function isFieldZone(zoneId: SimulatorZoneId) {
  return Boolean(FIELD_ZONE_TYPES[zoneId]);
}

function isSubFieldZone(zoneId: SimulatorZoneId) {
  return zoneId === "subField1" || zoneId === "subField2" || zoneId === "subField3";
}

function getCardCost(card: SimulatorCard) {
  if (card.cardType === "MAIN") {
    return card.mainCost?.trim() || "0";
  }

  if (card.cardType === "SUB") {
    return card.subCost?.trim() || "0";
  }

  return card.activeCost.trim() || "0";
}

function getActiveCost(card: SimulatorCard) {
  return card.activeCost.trim() || "0";
}

function getEffectCostValue(cost: string | null | undefined) {
  const parsedCost = Number.parseInt(cost?.trim() || "0", 10);

  return Number.isFinite(parsedCost) ? Math.max(0, parsedCost) : 0;
}

function getCardDisplayCost(card: SimulatorCard, zoneId?: SimulatorZoneId) {
  if (zoneId && isFieldZone(zoneId)) {
    return getCardCost(card);
  }

  return getActiveCost(card);
}

function getCostBadgeType(card: SimulatorCard, zoneId?: SimulatorZoneId) {
  if (zoneId && isFieldZone(zoneId)) {
    return card.cardType;
  }

  return "ACTIVE";
}

function getCardTypeLabel(cardType: string) {
  if (cardType === "MAIN") {
    return "메인";
  }

  if (cardType === "SUB") {
    return "서브";
  }

  if (cardType === "ACTIVE") {
    return "액티브";
  }

  return cardType;
}

function isEditableKeyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function SimulatorBoard({ cards, initialShuffleSeed, opponentLifeDefault }: SimulatorBoardProps) {
  const touchHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const stackListRef = useRef<HTMLDivElement | null>(null);
  const handListRef = useRef<HTMLDivElement | null>(null);
  const [zones, setZones] = useState<ZoneState>(() => createInitialZones(cards, (deckCards) => shuffleCardsWithSeed(deckCards, initialShuffleSeed)));
  const [cardVisualStates, setCardVisualStates] = useState<Record<string, CardVisualState>>(() => createInitialCardVisualStates(cards));
  const [powerModifiers, setPowerModifiers] = useState<Record<string, number>>({});
  const [opponentLife, setOpponentLife] = useState(opponentLifeDefault);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<DropTarget | null>(null);
  const [deckPeekOpen, setDeckPeekOpen] = useState(false);
  const [pileModalSource, setPileModalSource] = useState<PileModalSource | null>(null);
  const [peekDragIndex, setPeekDragIndex] = useState<number | null>(null);
  const [drawerCard, setDrawerCard] = useState<SimulatorCard | null>(null);
  const [hoveredStackIndex, setHoveredStackIndex] = useState<number | null>(null);
  const [hoveredHandIndex, setHoveredHandIndex] = useState<number | null>(null);
  const [stackLayout, setStackLayout] = useState<OverlapLayout>({ cardSize: 0, step: 0 });
  const [handLayout, setHandLayout] = useState<OverlapLayout>({ cardSize: 0, step: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [batchMove, setBatchMove] = useState<BatchMoveState | null>(null);
  const [effectNotice, setEffectNotice] = useState<string | null>(null);
  const [pendingEffectChoice, setPendingEffectChoice] = useState<PendingEffectChoice | null>(null);
  const [pendingEffectInput, setPendingEffectInput] = useState<PendingEffectInput | null>(null);

  const selectedCard = useMemo(() => cards.find((card) => card.id === selectedCardId) ?? null, [cards, selectedCardId]);
  const deckTopCard = zones.deck[0] ?? null;
  const deckPeekCards = zones.deck.slice(0, 3);
  const trashTopCard = zones.trash.at(-1) ?? null;

  useEffect(() => {
    if (isFullscreen) {
      document.body.dataset.simulatorFullscreen = "true";
    } else {
      delete document.body.dataset.simulatorFullscreen;
    }

    return () => {
      delete document.body.dataset.simulatorFullscreen;
    };
  }, [isFullscreen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPileModalSource(null);
        setDeckPeekOpen(false);
        setDrawerCard(null);
        setBatchMove(null);
        setPendingEffectChoice(null);
        setPendingEffectInput(null);
        return;
      }

      if ((event.code === "Space" || event.key === " ") && !event.repeat && !isEditableKeyTarget(event.target)) {
        if (pendingEffectChoice) {
          const requiredCount = getPendingEffectChoiceRequiredCount(pendingEffectChoice);

          if (pendingEffectChoice.selectedIds.length === requiredCount) {
            event.preventDefault();
            resolvePendingEffectChoice();
          }

          return;
        }

        if (drawerCard && !pendingEffectInput) {
          event.preventDefault();
          activateDrawerCardEffect(drawerCard);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerCard, pendingEffectChoice, pendingEffectInput, zones]);

  useEffect(() => {
    function calculateOverlapLayouts() {
      const stackElement = stackListRef.current;
      const handElement = handListRef.current;
      const stackCard = stackElement?.querySelector<HTMLElement>(".simulator-card");
      const handCard = handElement?.querySelector<HTMLElement>(".simulator-card");

      if (stackElement && stackCard) {
        const cardHeight = stackCard.offsetHeight;
        const availableHeight = stackElement.clientHeight;
        const maxStep = cardHeight + 8;
        const fittedStep = zones.stack.length > 1 ? Math.max(0, (availableHeight - cardHeight) / (zones.stack.length - 1)) : 0;

        setStackLayout({
          cardSize: cardHeight,
          step: zones.stack.length > 1 ? Math.min(maxStep, fittedStep) : 0,
        });
      } else {
        setStackLayout({ cardSize: 0, step: 0 });
      }

      if (handElement && handCard) {
        const cardWidth = handCard.offsetWidth;
        const availableWidth = handElement.clientWidth;
        const maxStep = cardWidth + 8;
        const fittedStep = zones.hand.length > 1 ? Math.max(0, (availableWidth - cardWidth) / (zones.hand.length - 1)) : 0;

        setHandLayout({
          cardSize: cardWidth,
          step: zones.hand.length > 1 ? Math.min(maxStep, fittedStep) : 0,
        });
      } else {
        setHandLayout({ cardSize: 0, step: 0 });
      }
    }

    calculateOverlapLayouts();

    const resizeObserver = new ResizeObserver(calculateOverlapLayouts);

    if (stackListRef.current) {
      resizeObserver.observe(stackListRef.current);
    }

    if (handListRef.current) {
      resizeObserver.observe(handListRef.current);
    }

    window.addEventListener("resize", calculateOverlapLayouts);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", calculateOverlapLayouts);
    };
  }, [zones.hand.length, zones.stack.length, isFullscreen]);

  function findCard(cardId: string) {
    for (const zoneId of Object.keys(zones) as SimulatorZoneId[]) {
      const card = zones[zoneId].find((zoneCard) => zoneCard.id === cardId);

      if (card) {
        return card;
      }
    }

    return null;
  }

  function findCardZoneIn(zoneState: ZoneState, cardId: string) {
    for (const zoneId of Object.keys(zoneState) as SimulatorZoneId[]) {
      if (zoneState[zoneId].some((zoneCard) => zoneCard.id === cardId)) {
        return zoneId;
      }
    }

    return null;
  }

  function getPlayableEffectEntry(card: SimulatorCard): EffectRunnerEntry | null {
    const cardZone = findCardZoneIn(zones, card.id);

    if (cardZone === "hand") {
      return {
        label: "액티브 효과",
        text: card.activeEffect,
        cost: card.activeCost,
        kind: "active",
      };
    }

    if (cardZone === "mainField") {
      return {
        label: "메인 효과",
        text: card.mainEffect,
        cost: card.mainCost,
        kind: "main",
      };
    }

    if (cardZone && isSubFieldZone(cardZone)) {
      return {
        label: "서브 효과",
        text: card.subEffect,
        cost: card.subCost,
        kind: "sub",
      };
    }

    return null;
  }

  function getDisplayPower(card: SimulatorCard) {
    if (card.power === null) {
      return null;
    }

    return card.power + (powerModifiers[card.id] ?? 0);
  }

  function canMoveTo(card: SimulatorCard | null, targetZone: SimulatorZoneId) {
    if (!card) {
      return false;
    }

    const sourceZone = findCardZoneIn(zones, card.id);

    if (sourceZone === "mainField" || targetZone === "mainField") {
      return false;
    }

    const requiredType = FIELD_ZONE_TYPES[targetZone];

    return !requiredType || card.cardType === requiredType;
  }

  function moveCard(cardId: string, targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    const card = findCard(cardId);

    if (!canMoveTo(card, targetZone)) {
      setSelectedCardId(null);
      return;
    }

    setZones((current) => {
      let movingCard: SimulatorCard | null = null;
      const nextZones = createEmptyZones();

      for (const zoneId of Object.keys(current) as SimulatorZoneId[]) {
        nextZones[zoneId] = current[zoneId].filter((zoneCard) => {
          if (zoneCard.id !== cardId) {
            return true;
          }

          movingCard = zoneCard;
          return false;
        });
      }

      if (!movingCard) {
        return current;
      }

      if (isFieldZone(targetZone)) {
        nextZones.hand = [...nextZones.hand, ...nextZones[targetZone]];
        nextZones[targetZone] = [movingCard];
      } else if (targetZone === "deck" && deckPlacement === "top") {
        nextZones.deck = [movingCard, ...nextZones.deck];
      } else {
        nextZones[targetZone] = [...nextZones[targetZone], movingCard];
      }

      return nextZones;
    });
    setSelectedCardId(null);
  }

  function getDraggedCard(event: DragEvent<HTMLElement>) {
    const cardId =
      event.dataTransfer.getData("application/x-stacker-simulator-card-id") ||
      event.dataTransfer.getData("text/plain") ||
      draggedCardId;

    return cardId ? findCard(cardId) : null;
  }

  function handleDragStart(event: DragEvent<HTMLElement>, card: SimulatorCard) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-stacker-simulator-card-id", card.id);
    event.dataTransfer.setData("text/plain", card.id);
    setDraggedCardId(card.id);
    setSelectedCardId(card.id);
  }

  function handleDragOver(event: DragEvent<HTMLElement>, target: DropTarget, targetZone: SimulatorZoneId) {
    const card = getDraggedCard(event);

    if (!canMoveTo(card, targetZone)) {
      event.dataTransfer.dropEffect = "none";
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setActiveDropTarget(target);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>, target: DropTarget) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setActiveDropTarget((current) => (current === target ? null : current));
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    event.preventDefault();
    event.stopPropagation();

    const cardId =
      event.dataTransfer.getData("application/x-stacker-simulator-card-id") ||
      event.dataTransfer.getData("text/plain") ||
      draggedCardId;

    if (cardId) {
      moveCard(cardId, targetZone, deckPlacement);
    }

    setDraggedCardId(null);
    setActiveDropTarget(null);
  }

  function handleCardClick(event: MouseEvent<HTMLElement>, cardId: string) {
    event.stopPropagation();

    if (longPressTriggeredRef.current) {
      event.preventDefault();
      longPressTriggeredRef.current = false;
      return;
    }

    setSelectedCardId((current) => (current === cardId ? null : cardId));
  }

  function handleSubFieldCardClick(event: MouseEvent<HTMLElement>, card: SimulatorCard) {
    event.stopPropagation();

    if (longPressTriggeredRef.current) {
      event.preventDefault();
      longPressTriggeredRef.current = false;
      return;
    }

    setSelectedCardId(null);
    setCardVisualStates((current) => {
      const currentState = current[card.id] ?? { faceDown: false, rotated: false };

      if (currentState.faceDown) {
        return {
          ...current,
          [card.id]: { faceDown: false, rotated: false },
        };
      }

      return {
        ...current,
        [card.id]: { faceDown: true, rotated: false },
      };
    });
  }

  function handleZoneClick(targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    if (selectedCardId) {
      moveCard(selectedCardId, targetZone, deckPlacement);
    }
  }

  function getBatchSourceCount(source: SimulatorZoneId) {
    return zones[source].length;
  }

  function startOrIncrementBatchMove(event: MouseEvent<HTMLElement>, source: SimulatorZoneId) {
    if (source === "mainField") {
      return;
    }

    const sourceCount = getBatchSourceCount(source);

    if (sourceCount === 0) {
      return;
    }

    setBatchMove((current) => {
      if (current?.source === source) {
        return {
          ...current,
          count: Math.min(sourceCount, current.count + 1),
          x: event.clientX,
          y: event.clientY,
        };
      }

      return {
        source,
        count: 1,
        x: event.clientX,
        y: event.clientY,
      };
    });
  }

  function moveBatchCards(source: SimulatorZoneId, targetZone: SimulatorZoneId, count: number, deckPlacement: DeckPlacement = "bottom") {
    if (source === "mainField" || targetZone === "mainField") {
      return;
    }

    setZones((current) => {
      const sourceCards = current[source];
      const candidateCards = source === "trash" ? sourceCards.slice(Math.max(sourceCards.length - count, 0)) : sourceCards.slice(0, count);
      const movingCards = isFieldZone(targetZone) ? candidateCards.filter((card) => canMoveTo(card, targetZone)).slice(0, 1) : candidateCards;

      if (movingCards.length === 0) {
        return current;
      }

      const movingIds = new Set(movingCards.map((card) => card.id));
      const nextZones = {
        ...current,
        [source]: current[source].filter((card) => !movingIds.has(card.id)),
      };

      if (isFieldZone(targetZone)) {
        nextZones.hand = [...nextZones.hand, ...nextZones[targetZone]];
        nextZones[targetZone] = movingCards;
      } else if (targetZone === "deck" && deckPlacement === "top") {
        nextZones.deck = [...movingCards, ...nextZones.deck];
      } else {
        nextZones[targetZone] = [...nextZones[targetZone], ...movingCards];
      }

      return nextZones;
    });
    setSelectedCardId(null);
  }

  function takeTopCardsForEffect(zoneCards: SimulatorCard[], count: number, source: "deck" | "stack" | "trash") {
    if (source === "trash") {
      return zoneCards.slice(Math.max(zoneCards.length - count, 0));
    }

    return zoneCards.slice(0, count);
  }

  function cloneZones(zoneState: ZoneState): ZoneState {
    return {
      deck: [...zoneState.deck],
      hand: [...zoneState.hand],
      stack: [...zoneState.stack],
      trash: [...zoneState.trash],
      mainField: [...zoneState.mainField],
      subField1: [...zoneState.subField1],
      subField2: [...zoneState.subField2],
      subField3: [...zoneState.subField3],
    };
  }

  function buildPreparedEffectZones(zoneState: ZoneState, card: SimulatorCard, cost: number, moveUsedCardToStack: boolean) {
    const cardZone = findCardZoneIn(zoneState, card.id);
    const payableStackCount = moveUsedCardToStack ? zoneState.stack.filter((stackCard) => stackCard.id !== card.id).length : zoneState.stack.length;

    if (!cardZone) {
      return { error: "사용한 카드를 현재 보드에서 찾을 수 없습니다." };
    }

    if (payableStackCount < cost) {
      return { error: `코스트 부족 (필요 ${cost}, 스택 ${payableStackCount})` };
    }

    const usedCard = zoneState[cardZone].find((zoneCard) => zoneCard.id === card.id);

    if (!usedCard) {
      return { error: "사용한 카드를 현재 보드에서 찾을 수 없습니다." };
    }

    const nextZones = cloneZones(zoneState);
    const costCards = nextZones.stack.filter((stackCard) => !moveUsedCardToStack || stackCard.id !== card.id).slice(0, cost);
    const costCardIds = new Set(costCards.map((costCard) => costCard.id));

    if (moveUsedCardToStack) {
      for (const zoneId of Object.keys(nextZones) as SimulatorZoneId[]) {
        nextZones[zoneId] = nextZones[zoneId].filter((zoneCard) => zoneCard.id !== card.id);
      }
    }

    nextZones.stack = nextZones.stack.filter((stackCard) => !costCardIds.has(stackCard.id));
    nextZones.trash.push(...costCards);

    if (moveUsedCardToStack) {
      nextZones.stack.push(usedCard);
    }

    return { zones: nextZones };
  }

  function addCardsToEffectTarget(zoneState: ZoneState, target: "deckBottom" | "hand" | "stack" | "trash", movingCards: SimulatorCard[]) {
    if (target === "deckBottom") {
      zoneState.deck.push(...movingCards);
    } else {
      zoneState[target].push(...movingCards);
    }
  }

  function validateEffectActions(actions: EffectAction[], baseZones: ZoneState): { ok: true; zones: ZoneState } | { ok: false; error: string } {
    const nextZones = cloneZones(baseZones);

    for (const action of actions) {
      if (action.type === "draw") {
        if (nextZones.deck.length < action.count) {
          return { ok: false, error: `드로우할 카드가 부족합니다. (필요 ${action.count}, 덱 ${nextZones.deck.length})` };
        }

        nextZones.hand.push(...nextZones.deck.splice(0, action.count));
        continue;
      }

      if (action.type === "drawThenTrashNonActive") {
        if (nextZones.deck.length < action.count) {
          return { ok: false, error: `드로우할 카드가 부족합니다. (필요 ${action.count}, 덱 ${nextZones.deck.length})` };
        }

        const drawnCards = nextZones.deck.splice(0, action.count);
        nextZones.hand.push(...drawnCards.filter((card) => card.cardType === "ACTIVE"));
        nextZones.trash.push(...drawnCards.filter((card) => card.cardType !== "ACTIVE"));
        continue;
      }

      if (action.type === "drawThenChooseCards") {
        if (nextZones.deck.length < action.drawCount) {
          return { ok: false, error: `드로우할 카드가 부족합니다. (필요 ${action.drawCount}, 덱 ${nextZones.deck.length})` };
        }

        const drawnCards = nextZones.deck.splice(0, action.drawCount);
        const selectableCards = drawnCards.filter((card) => cardMatchesEffectFilter(card, action.filter));

        if (selectableCards.length < action.chooseCount) {
          return { ok: false, error: `드로우한 카드 중 선택 가능한 카드가 부족합니다. (필요 ${action.chooseCount}, 현재 ${selectableCards.length})` };
        }

        const movingCards = selectableCards.slice(0, action.chooseCount);
        const movingIds = new Set(movingCards.map((movingCard) => movingCard.id));
        nextZones.hand.push(...drawnCards.filter((card) => !movingIds.has(card.id)));
        addCardsToEffectTarget(nextZones, action.target, movingCards);
        continue;
      }

      if (action.type === "moveTop") {
        if (nextZones[action.from].length < action.count) {
          return { ok: false, error: `${action.from}에 옮길 카드가 부족합니다. (필요 ${action.count}, 현재 ${nextZones[action.from].length})` };
        }

        const movingCards = takeTopCardsForEffect(nextZones[action.from], action.count, action.from);
        const movingIds = new Set(movingCards.map((movingCard) => movingCard.id));
        nextZones[action.from] = nextZones[action.from].filter((zoneCard) => !movingIds.has(zoneCard.id));
        addCardsToEffectTarget(nextZones, action.to, movingCards);
        continue;
      }

      if (action.type === "damageSelf") {
        if (nextZones.deck.length < action.amount) {
          return { ok: false, error: `자신이 받을 대미지를 처리할 덱 카드가 부족합니다. (필요 ${action.amount}, 덱 ${nextZones.deck.length})` };
        }

        nextZones.trash.push(...nextZones.deck.splice(0, action.amount));
        continue;
      }

      if (action.type === "chooseCards") {
        const selectableCards = nextZones[action.source].filter((zoneCard) => cardMatchesEffectFilter(zoneCard, action.filter));

        if (selectableCards.length < action.count) {
          return { ok: false, error: `${action.source}에 선택 가능한 카드가 부족합니다. (필요 ${action.count}, 현재 ${selectableCards.length})` };
        }

        const movingCards = selectableCards.slice(0, action.count);
        const movingIds = new Set(movingCards.map((movingCard) => movingCard.id));

        if (action.selectedPowerResult === "modifyMainPower") {
          if (nextZones.mainField.length === 0) {
            return { ok: false, error: "파워를 올릴 메인 스태커가 없습니다." };
          }

          const powerlessCard = movingCards.find((movingCard) => movingCard.power === null);

          if (powerlessCard) {
            return { ok: false, error: `${powerlessCard.name}의 파워 수치가 없어 파워 상승을 처리할 수 없습니다.` };
          }
        }

        nextZones[action.source] = nextZones[action.source].filter((zoneCard) => !movingIds.has(zoneCard.id));
        addCardsToEffectTarget(nextZones, action.target, movingCards);

        if (action.afterActions?.length) {
          const afterValidation = validateEffectActions(action.afterActions, nextZones);

          if (!afterValidation.ok) {
            return afterValidation;
          }

          Object.assign(nextZones, afterValidation.zones);
        }

        continue;
      }

      if (action.type === "inputCardType") {
        if (nextZones.deck.length < 1) {
          return { ok: false, error: "선언 효과로 드로우할 카드가 덱에 없습니다." };
        }

        const afterDrawZones = cloneZones(nextZones);
        const [drawnCard, ...deckRest] = afterDrawZones.deck;
        afterDrawZones.deck = deckRest;
        afterDrawZones.hand.push(drawnCard);

        const trueValidation = validateEffectActions(action.trueActions ?? [], afterDrawZones);

        if (!trueValidation.ok) {
          return trueValidation;
        }

        const falseValidation = validateEffectActions(action.falseActions ?? [], afterDrawZones);

        if (!falseValidation.ok) {
          return falseValidation;
        }

        nextZones.deck = afterDrawZones.deck;
        nextZones.hand = afterDrawZones.hand;
        continue;
      }

      if (action.type === "inputBoolean") {
        const trueValidation = validateEffectActions(action.trueActions ?? [], nextZones);

        if (!trueValidation.ok) {
          return trueValidation;
        }

        const falseValidation = validateEffectActions(action.falseActions ?? [], nextZones);

        if (!falseValidation.ok) {
          return falseValidation;
        }

        continue;
      }

      if (action.type === "modifyMainPower" && nextZones.mainField.length === 0) {
        return { ok: false, error: "파워를 올릴 메인 스태커가 없습니다." };
      }
    }

    return { ok: true, zones: nextZones };
  }

  function payEffectCostAndPrepareUsedCard(card: SimulatorCard, cost: number, effectLabel: string, moveUsedCardToStack: boolean) {
    const cardZone = findCardZoneIn(zones, card.id);
    const payableStackCount = moveUsedCardToStack ? zones.stack.filter((stackCard) => stackCard.id !== card.id).length : zones.stack.length;

    if (!cardZone) {
      setEffectNotice(`${effectLabel}: 사용한 카드를 현재 보드에서 찾을 수 없습니다.`);
      return false;
    }

    if (payableStackCount < cost) {
      setEffectNotice(`${effectLabel}: 코스트 부족 (필요 ${cost}, 스택 ${payableStackCount})`);
      return false;
    }

    setZones((current) => {
      const currentCardZone = findCardZoneIn(current, card.id);

      if (!currentCardZone) {
        return current;
      }

      const usedCard = current[currentCardZone].find((zoneCard) => zoneCard.id === card.id);

      if (!usedCard) {
        return current;
      }

      const nextZones: ZoneState = {
        deck: [...current.deck],
        hand: [...current.hand],
        stack: [...current.stack],
        trash: [...current.trash],
        mainField: [...current.mainField],
        subField1: [...current.subField1],
        subField2: [...current.subField2],
        subField3: [...current.subField3],
      };
      const costCards = nextZones.stack.filter((stackCard) => !moveUsedCardToStack || stackCard.id !== card.id).slice(0, cost);
      const costCardIds = new Set(costCards.map((costCard) => costCard.id));

      if (moveUsedCardToStack) {
        for (const zoneId of Object.keys(nextZones) as SimulatorZoneId[]) {
          nextZones[zoneId] = nextZones[zoneId].filter((zoneCard) => zoneCard.id !== card.id);
        }
      }

      nextZones.stack = nextZones.stack.filter((stackCard) => !costCardIds.has(stackCard.id));
      nextZones.trash.push(...costCards);

      if (moveUsedCardToStack) {
        nextZones.stack.push(usedCard);
      }

      return nextZones;
    });

    if (moveUsedCardToStack) {
      setCardVisualStates((current) => ({
        ...current,
        [card.id]: {
          faceDown: false,
          rotated: false,
        },
      }));
    }

    setSelectedCardId(null);

    return true;
  }

  function applyEffectActions(actions: EffectAction[]) {
    const damageAmount = actions.reduce((sum, action) => (action.type === "damageOpponent" ? sum + action.amount : sum), 0);
    const opponentLifeChange = actions.reduce((sum, action) => (action.type === "changeOpponentLife" ? sum + action.amount : sum), 0);
    const mainPowerChange = actions.reduce((sum, action) => (action.type === "modifyMainPower" ? sum + action.amount : sum), 0);
    const mainCardId = zones.mainField[0]?.id ?? null;

    setZones((current) => {
      const nextZones: ZoneState = {
        deck: [...current.deck],
        hand: [...current.hand],
        stack: [...current.stack],
        trash: [...current.trash],
        mainField: [...current.mainField],
        subField1: [...current.subField1],
        subField2: [...current.subField2],
        subField3: [...current.subField3],
      };

      for (const action of actions) {
        if (action.type === "damageOpponent") {
          continue;
        }

        if (action.type === "damageSelf") {
          nextZones.trash.push(...nextZones.deck.splice(0, action.amount));
          continue;
        }

        if (action.type === "changeOpponentLife") {
          continue;
        }

        if (action.type === "modifyMainPower") {
          continue;
        }

        if (action.type === "chooseCards") {
          continue;
        }

        if (action.type === "inputNumber" || action.type === "inputBoolean" || action.type === "inputCardType" || action.type === "drawThenChooseCards") {
          continue;
        }

        if (action.type === "mulliganHand") {
          const drawCount = nextZones.hand.length;
          const shuffledDeck = shuffleCards([...nextZones.deck, ...nextZones.hand]);
          nextZones.hand = shuffledDeck.slice(0, drawCount);
          nextZones.deck = shuffledDeck.slice(drawCount);
          continue;
        }

        if (action.type === "drawThenTrashNonActive") {
          const drawnCards = nextZones.deck.splice(0, action.count);
          const activeCards = drawnCards.filter((card) => card.cardType === "ACTIVE");
          const nonActiveCards = drawnCards.filter((card) => card.cardType !== "ACTIVE");
          nextZones.hand.push(...activeCards);
          nextZones.trash.push(...nonActiveCards);
          continue;
        }

        if (action.type === "draw") {
          const drawnCards = nextZones.deck.splice(0, action.count);
          nextZones.hand.push(...drawnCards);
          continue;
        }

        const sourceCards = nextZones[action.from];
        const movingCards = takeTopCardsForEffect(sourceCards, action.count, action.from);
        const movingIds = new Set(movingCards.map((card) => card.id));
        nextZones[action.from] = sourceCards.filter((card) => !movingIds.has(card.id));

        if (action.to === "deckBottom") {
          nextZones.deck.push(...movingCards);
        } else {
          nextZones[action.to].push(...movingCards);
        }
      }

      return nextZones;
    });

    const totalOpponentLifeChange = opponentLifeChange - damageAmount;

    if (totalOpponentLifeChange !== 0) {
      setOpponentLife((current) => Math.max(0, current + totalOpponentLifeChange));
    }

    if (mainPowerChange !== 0 && mainCardId) {
      setPowerModifiers((current) => ({
        ...current,
        [mainCardId]: (current[mainCardId] ?? 0) + mainPowerChange,
      }));
    }
  }

  function executeEffectActions(actions: EffectAction[], effectLabel: string) {
    const immediateActions: EffectAction[] = [];

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];

      if (
        action.type !== "chooseCards" &&
        action.type !== "inputNumber" &&
        action.type !== "inputBoolean" &&
        action.type !== "inputCardType" &&
        action.type !== "drawThenChooseCards"
      ) {
        immediateActions.push(action);
        continue;
      }

      if (immediateActions.length > 0) {
        applyEffectActions(immediateActions);
      }

      if (action.type === "inputNumber" || action.type === "inputBoolean" || action.type === "inputCardType") {
        setPileModalSource(null);
        setDeckPeekOpen(false);
        setSelectedCardId(null);
        setPendingEffectInput({
          ...action,
          label: effectLabel,
          remainingActions: actions.slice(index + 1),
          value: action.type === "inputNumber" ? String(action.defaultValue ?? action.min ?? 0) : action.type === "inputCardType" ? "ACTIVE" : "true",
        });
        return "pending";
      }

      if (action.type === "drawThenChooseCards") {
        const drawnCards = zones.deck.slice(0, action.drawCount);

        setZones((current) => {
          const drawnCardIds = new Set(drawnCards.map((card) => card.id));

          return {
            ...current,
            deck: current.deck.filter((card) => !drawnCardIds.has(card.id)),
            hand: [...current.hand, ...drawnCards],
          };
        });
        setPileModalSource(null);
        setDeckPeekOpen(false);
        setSelectedCardId(null);
        setPendingEffectChoice({
          type: "chooseCards",
          source: "hand",
          target: action.target,
          count: action.chooseCount,
          filter: action.filter,
          prompt: action.prompt,
          label: effectLabel,
          remainingActions: actions.slice(index + 1),
          selectedIds: [],
          candidateIds: drawnCards.map((card) => card.id),
        });
        return "pending";
      }

      setPileModalSource(null);
      setDeckPeekOpen(false);
      setSelectedCardId(null);
      setPendingEffectChoice({
        ...action,
        label: effectLabel,
        remainingActions: [...(action.afterActions ?? []), ...actions.slice(index + 1)],
        selectedIds: [],
      });
      return "pending";
    }

    if (immediateActions.length > 0) {
      applyEffectActions(immediateActions);
    }

    return "done";
  }

  function createActionsFromEffectInput(action: EffectInputAction, value: string): { actions: EffectAction[]; notice?: string } {
    if (action.type === "inputBoolean") {
      const selectedTrue = value === "true";

      return {
        actions: selectedTrue ? (action.trueActions ?? []) : (action.falseActions ?? []),
        notice: selectedTrue ? action.trueNotice : action.falseNotice,
      };
    }

    if (action.type === "inputCardType") {
      return { actions: [] };
    }

    const numericValue = Number.parseInt(value, 10);
    const inputValue = Number.isFinite(numericValue) ? Math.max(action.min ?? 0, numericValue) : Number.NaN;

    if (action.result === "draw") {
      return { actions: [{ type: "draw", count: inputValue }] };
    }

    if (action.result === "damageOpponent") {
      return { actions: [{ type: "damageOpponent", amount: inputValue }] };
    }

    if (action.result === "modifyMainPower") {
      return { actions: [{ type: "modifyMainPower", amount: inputValue }] };
    }

    return {
      actions: [
        {
          type: "moveTop",
          from: "trash",
          to: "deckBottom",
          count: inputValue,
        },
      ],
    };
  }

  function resolvePendingEffectInput(valueOverride?: string) {
    if (!pendingEffectInput) {
      return;
    }

    const submittedValue = valueOverride ?? pendingEffectInput.value;

    if (pendingEffectInput.type === "inputCardType") {
      const declaredType = submittedValue;
      const drawnCard = zones.deck[0] ?? null;

      if (!["ACTIVE", "MAIN", "SUB"].includes(declaredType)) {
        setEffectNotice(`${pendingEffectInput.label}: 선언할 카드 타입을 선택하세요.`);
        return;
      }

      if (!drawnCard) {
        setEffectNotice(`${pendingEffectInput.label}: 드로우할 카드가 덱에 없습니다.`);
        return;
      }

      const matched = drawnCard.cardType === declaredType;
      const choice = pendingEffectInput;
      const branchActions = matched ? (choice.trueActions ?? []) : (choice.falseActions ?? []);
      const branchNotice = matched ? choice.trueNotice : choice.falseNotice;
      const afterDrawZones = cloneZones(zones);
      afterDrawZones.deck = afterDrawZones.deck.slice(1);
      afterDrawZones.hand.push(drawnCard);
      const validation = validateEffectActions([...branchActions, ...choice.remainingActions], afterDrawZones);

      if (!validation.ok) {
        setEffectNotice(`${choice.label}: ${validation.error}`);
        return;
      }

      setZones((current) => {
        const [topCard, ...deckRest] = current.deck;

        if (!topCard || topCard.id !== drawnCard.id) {
          return current;
        }

        return {
          ...current,
          deck: deckRest,
          hand: [...current.hand, topCard],
        };
      });
      setPendingEffectInput(null);
      const executionStatus = executeEffectActions([...branchActions, ...choice.remainingActions], choice.label);
      setEffectNotice(
        [
          `${choice.label}: ${getCardTypeLabel(declaredType)} 선언 · ${drawnCard.name}(${getCardTypeLabel(drawnCard.cardType)}) 드로우 · ${matched ? "성공" : "실패"}`,
          executionStatus === "pending" ? "다음 선택 대기 중" : null,
          branchNotice,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      return;
    }

    if (pendingEffectInput.type === "inputNumber") {
      const numericValue = Number.parseInt(submittedValue, 10);

      if (!Number.isFinite(numericValue)) {
        setEffectNotice(`${pendingEffectInput.label}: 숫자를 입력하세요.`);
        return;
      }
    }

    const choice = pendingEffectInput;
    const resolvedInput = createActionsFromEffectInput(choice, submittedValue);
    const nextActions = [...resolvedInput.actions, ...choice.remainingActions];
    const validation = validateEffectActions(nextActions, zones);

    if (!validation.ok) {
      setEffectNotice(`${choice.label}: ${validation.error}`);
      return;
    }

    setPendingEffectInput(null);
    const executionStatus = executeEffectActions(nextActions, choice.label);
    setEffectNotice(
      [
        executionStatus === "pending" ? `${choice.label}: 입력 처리 완료 · 다음 선택 대기 중` : `${choice.label}: 입력 처리 완료`,
        resolvedInput.notice,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  function runEffect(effectLabel: string, effectText: string, sourceCard: SimulatorCard, effectCost: string | null, effectKind: EffectKind) {
    const cost = getEffectCostValue(effectCost);
    const moveUsedCardToStack = effectKind === "active";
    const compiled = compileEffectText(effectText);
    const preparedZones = buildPreparedEffectZones(zones, sourceCard, cost, moveUsedCardToStack);

    if (preparedZones.error || !preparedZones.zones) {
      setEffectNotice(`${effectLabel}: ${preparedZones.error}`);
      return;
    }

    const validation = validateEffectActions(compiled.actions, preparedZones.zones);

    if (!validation.ok) {
      setEffectNotice(`${effectLabel}: ${validation.error}`);
      return;
    }

    if (!payEffectCostAndPrepareUsedCard(sourceCard, cost, effectLabel, moveUsedCardToStack)) {
      return;
    }

    setDrawerCard(null);
    const executionStatus = executeEffectActions(compiled.actions, effectLabel);
    const messageParts = [
      `${effectLabel}: 코스트 ${cost} 지불`,
      moveUsedCardToStack ? "사용 카드 스택 이동" : "사용 카드 위치 유지",
      `자동 처리 ${compiled.actions.length}개`,
    ];

    if (executionStatus === "pending") {
      messageParts.push("선택 대기 중");
    }

    if (compiled.manualSteps.length > 0) {
      messageParts.push(`수동 처리 필요 ${compiled.manualSteps.length}개`);
    }

    setEffectNotice(messageParts.join(" · "));
  }

  function activateDrawerCardEffect(card: SimulatorCard) {
    if (pendingEffectChoice || pendingEffectInput) {
      setEffectNotice("먼저 진행 중인 효과 입력/선택을 완료하세요.");
      return;
    }

    const playableEffect = getPlayableEffectEntry(card);

    if (!playableEffect?.text) {
      setEffectNotice("현재 위치에서 발동 가능한 효과가 없습니다.");
      return;
    }

    if (card.name === "부활의 손짓" && zones.trash.length < 1) {
      setEffectNotice("부활의 손짓: 트래시 존에 카드가 1장 이상 있어야 사용할 수 있습니다.");
      return;
    }

    runEffect(playableEffect.label, playableEffect.text, card, playableEffect.cost, playableEffect.kind);
  }

  function cardMatchesEffectFilter(card: SimulatorCard, filter?: EffectCardFilter) {
    if (!filter?.cardType) {
      return true;
    }

    return card.cardType === filter.cardType;
  }

  function getPendingEffectChoiceCards(choice: PendingEffectChoice) {
    const candidateIds = choice.candidateIds ? new Set(choice.candidateIds) : null;

    return zones[choice.source].filter((card) => (!candidateIds || candidateIds.has(card.id)) && cardMatchesEffectFilter(card, choice.filter));
  }

  function getPendingEffectChoiceRequiredCount(choice: PendingEffectChoice) {
    return Math.min(choice.count, getPendingEffectChoiceCards(choice).length);
  }

  function togglePendingEffectChoiceCard(cardId: string) {
    setPendingEffectChoice((current) => {
      if (!current) {
        return current;
      }

      if (current.selectedIds.includes(cardId)) {
        return {
          ...current,
          selectedIds: current.selectedIds.filter((selectedId) => selectedId !== cardId),
        };
      }

      const candidateIds = current.candidateIds ? new Set(current.candidateIds) : null;
      const selectableCount = zones[current.source].filter((card) => (!candidateIds || candidateIds.has(card.id)) && cardMatchesEffectFilter(card, current.filter)).length;
      const requiredCount = Math.min(current.count, selectableCount);

      if (current.selectedIds.length >= requiredCount) {
        return current;
      }

      return {
        ...current,
        selectedIds: [...current.selectedIds, cardId],
      };
    });
  }

  function resolvePendingEffectChoice() {
    if (!pendingEffectChoice) {
      return;
    }

    const choice = pendingEffectChoice;
    const requiredCount = getPendingEffectChoiceRequiredCount(choice);

    if (choice.selectedIds.length !== requiredCount) {
      return;
    }

    const selectedIds = new Set(choice.selectedIds);
    const selectedCards = zones[choice.source].filter((card) => selectedIds.has(card.id));
    const selectedPowerAmount =
      choice.selectedPowerResult === "modifyMainPower" ? selectedCards.reduce((sum, card) => sum + (card.power ?? 0), 0) : 0;
    const powerResultMainCardId = choice.selectedPowerResult === "modifyMainPower" ? zones.mainField[0]?.id ?? null : null;

    if (selectedCards.length !== requiredCount) {
      setEffectNotice(`${choice.label}: 선택한 카드를 현재 영역에서 찾을 수 없습니다.`);
      return;
    }

    if (choice.selectedPowerResult === "modifyMainPower") {
      if (!powerResultMainCardId) {
        setEffectNotice(`${choice.label}: 파워를 올릴 메인 스태커가 없습니다.`);
        return;
      }

      const powerlessCard = selectedCards.find((card) => card.power === null);

      if (powerlessCard) {
        setEffectNotice(`${choice.label}: ${powerlessCard.name}의 파워 수치가 없어 파워 상승을 처리할 수 없습니다.`);
        return;
      }
    }

    setZones((current) => {
      const currentSelectedCards = current[choice.source].filter((card) => selectedIds.has(card.id));

      if (currentSelectedCards.length !== requiredCount) {
        return current;
      }

      const nextZones: ZoneState = {
        ...current,
        deck: [...current.deck],
        hand: [...current.hand],
        stack: [...current.stack],
        trash: [...current.trash],
        mainField: [...current.mainField],
        subField1: [...current.subField1],
        subField2: [...current.subField2],
        subField3: [...current.subField3],
      };

      nextZones[choice.source] = nextZones[choice.source].filter((card) => !selectedIds.has(card.id));

      if (choice.target === "deckBottom") {
        nextZones.deck.push(...currentSelectedCards);
      } else {
        nextZones[choice.target].push(...currentSelectedCards);
      }

      if (choice.shuffleDeckAfter) {
        nextZones.deck = shuffleCards(nextZones.deck);
      }

      return nextZones;
    });

    if (choice.selectedPowerResult === "modifyMainPower" && powerResultMainCardId) {
      setPowerModifiers((current) => ({
        ...current,
        [powerResultMainCardId]: (current[powerResultMainCardId] ?? 0) + selectedPowerAmount,
      }));
    }

    setPendingEffectChoice(null);
    const executionStatus = executeEffectActions(choice.remainingActions, choice.label);
    setEffectNotice(
      [
        executionStatus === "pending" ? `${choice.label}: 다음 선택 대기 중` : `${choice.label}: 선택 처리 완료`,
        choice.selectedPowerResult === "modifyMainPower" ? `메인 파워 +${selectedPowerAmount}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  function handleZoneBackgroundClick(event: MouseEvent<HTMLElement>, targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    if (selectedCardId) {
      moveCard(selectedCardId, targetZone, deckPlacement);
      return;
    }

    if (batchMove) {
      if (batchMove.source === targetZone) {
        startOrIncrementBatchMove(event, targetZone);
      } else {
        moveBatchCards(batchMove.source, targetZone, batchMove.count, deckPlacement);
        setBatchMove(null);
      }

      return;
    }

    startOrIncrementBatchMove(event, targetZone);
  }

  function drawOneCard() {
    setZones((current) => {
      const [topCard, ...deckRest] = current.deck;

      if (!topCard) {
        return current;
      }

      return {
        ...current,
        deck: deckRest,
        hand: [...current.hand, topCard],
      };
    });
    setSelectedCardId(null);
  }

  function shuffleDeck() {
    setZones((current) => ({
      ...current,
      deck: shuffleCards(current.deck),
    }));
    setSelectedCardId(null);
  }

  function mulliganHand() {
    setZones((current) => {
      const drawCount = current.hand.length;

      if (drawCount === 0) {
        return current;
      }

      const shuffledCards = shuffleCards([...current.hand, ...current.deck]);

      return {
        ...current,
        deck: shuffledCards.slice(drawCount),
        hand: shuffledCards.slice(0, drawCount),
      };
    });
    setSelectedCardId(null);
  }

  function moveStackTopCardsToTrash(count: number) {
    setZones((current) => {
      const movingCards = current.stack.slice(0, count);

      if (movingCards.length === 0) {
        return current;
      }

      return {
        ...current,
        stack: current.stack.slice(movingCards.length),
        trash: [...current.trash, ...movingCards],
      };
    });
    setSelectedCardId(null);
  }

  function resetBoard() {
    setZones(createInitialZones(cards, shuffleCards));
    setCardVisualStates(createInitialCardVisualStates(cards));
    setPowerModifiers({});
    setOpponentLife(opponentLifeDefault);
    setSelectedCardId(null);
    setDraggedCardId(null);
    setActiveDropTarget(null);
    setDeckPeekOpen(false);
    setDrawerCard(null);
    setPendingEffectChoice(null);
    setPendingEffectInput(null);
    setEffectNotice(null);
  }

  function reorderDeckTop(fromIndex: number, toIndex: number) {
    setZones((current) => {
      const topCards = current.deck.slice(0, 3);
      const restCards = current.deck.slice(3);
      const [movedCard] = topCards.splice(fromIndex, 1);

      if (!movedCard) {
        return current;
      }

      topCards.splice(toIndex, 0, movedCard);

      return {
        ...current,
        deck: [...topCards, ...restCards],
      };
    });
  }

  function openCardDrawer(event: MouseEvent<HTMLElement>, card: SimulatorCard) {
    event.preventDefault();
    event.stopPropagation();
    setDrawerCard(card);
  }

  function clearTouchHoldTimer() {
    if (touchHoldTimerRef.current) {
      clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }
  }

  function handleCardTouchStart(event: TouchEvent<HTMLElement>, card: SimulatorCard) {
    event.stopPropagation();
    clearTouchHoldTimer();
    longPressTriggeredRef.current = false;
    touchHoldTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setSelectedCardId(null);
      setDrawerCard(card);
    }, 520);
  }

  function handleCardTouchEnd() {
    clearTouchHoldTimer();

    if (longPressTriggeredRef.current) {
      setTimeout(() => {
        longPressTriggeredRef.current = false;
      }, 350);
    }
  }

  function getDropClass(target: DropTarget, targetZone: SimulatorZoneId) {
    const activeCard = selectedCard ?? (draggedCardId ? findCard(draggedCardId) : null);
    const classes = ["simulator-mat-zone"];

    if (activeCard && !canMoveTo(activeCard, targetZone)) {
      classes.push("drop-blocked");
    } else if (activeCard && activeDropTarget === target) {
      classes.push("drop-active");
    } else if (activeCard) {
      classes.push("drop-ready");
    } else if (batchMove) {
      const sourceCards = zones[batchMove.source];
      const candidateCards = batchMove.source === "trash" ? sourceCards.slice(Math.max(sourceCards.length - batchMove.count, 0)) : sourceCards.slice(0, batchMove.count);
      const canMoveBatch = isFieldZone(targetZone) ? candidateCards.some((card) => canMoveTo(card, targetZone)) : candidateCards.length > 0;

      if (!canMoveBatch) {
        classes.push("drop-blocked");
      } else {
        classes.push(batchMove.source === targetZone ? "drop-active" : "drop-ready");
      }
    }

    return classes.join(" ");
  }

  function getStackCardStyle(index: number): CSSProperties {
    const hoverGap = hoveredStackIndex !== null && index > hoveredStackIndex ? Math.max(0, stackLayout.cardSize - stackLayout.step + 8) : 0;

    return {
      top: `${index * stackLayout.step + hoverGap}px`,
      zIndex: hoveredStackIndex === index ? 50 : index + 1,
    };
  }

  function getHandCardStyle(index: number): CSSProperties {
    const hoverGap = hoveredHandIndex !== null && index > hoveredHandIndex ? Math.max(0, handLayout.cardSize - handLayout.step + 8) : 0;

    return {
      left: `${index * handLayout.step + hoverGap}px`,
      zIndex: hoveredHandIndex === index ? 50 : index + 1,
    };
  }

  function handleOverlapPointerEnter(event: PointerEvent<HTMLElement>, zone: "stack" | "hand", index: number) {
    if (event.pointerType !== "mouse") {
      return;
    }

    if (zone === "stack") {
      setHoveredStackIndex(index);
    } else {
      setHoveredHandIndex(index);
    }
  }

  function handleOverlapPointerLeave(zone: "stack" | "hand") {
    if (zone === "stack") {
      setHoveredStackIndex(null);
    } else {
      setHoveredHandIndex(null);
    }
  }

  function renderFaceCard(card: SimulatorCard, compact = false, zoneId?: SimulatorZoneId, style?: CSSProperties, overlapHandlers?: {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
  }, forceFaceUp = false) {
    const isSelected = selectedCardId === card.id;
    const visualState = cardVisualStates[card.id] ?? { faceDown: false, rotated: false };
    const isFaceDown = visualState.faceDown && !forceFaceUp;
    const isSubFieldCard = zoneId ? isSubFieldZone(zoneId) : false;
    const displayPower = zoneId === "mainField" ? getDisplayPower(card) : null;
    const isPowerBoosted = (powerModifiers[card.id] ?? 0) > 0;
    const classNames = [
      "simulator-card",
      isSelected ? "selected" : "",
      isFaceDown ? "face-down" : "",
      isSubFieldCard && visualState.rotated ? "rotated" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <article
        className={classNames}
        data-compact={compact ? "true" : undefined}
        draggable
        key={card.id}
        onClick={(event) => (isSubFieldCard ? handleSubFieldCardClick(event, card) : handleCardClick(event, card.id))}
        onContextMenu={(event) => openCardDrawer(event, card)}
        onDragEnd={() => {
          setDraggedCardId(null);
          setActiveDropTarget(null);
        }}
        onDragStart={(event) => handleDragStart(event, card)}
        onTouchCancel={handleCardTouchEnd}
        onTouchEnd={handleCardTouchEnd}
        onTouchMove={handleCardTouchEnd}
        onTouchStart={(event) => handleCardTouchStart(event, card)}
        onPointerEnter={overlapHandlers?.onPointerEnter}
        onPointerLeave={overlapHandlers?.onPointerLeave}
        style={style}
        tabIndex={0}
      >
        <div className="simulator-card-image">
          {isFaceDown ? (
            <div className="simulator-card-back-face">
              <strong>STACKER</strong>
            </div>
          ) : (
              <CardImage src={card.imageUrl} alt={card.name} />
          )}
          <span className="simulator-card-cost-badge" data-cost-type={getCostBadgeType(card, zoneId)}>
            {getCardDisplayCost(card, zoneId)}
          </span>
          {displayPower !== null ? (
            <span className="simulator-card-power-badge" data-boosted={isPowerBoosted ? "true" : undefined}>
              {displayPower}
            </span>
          ) : null}
        </div>
        <div className="simulator-card-caption">
          <strong>{card.name}</strong>
          <span>
            {card.cardType} · {getCardCost(card)}
          </span>
        </div>
      </article>
    );
  }

  function renderPeekCard(card: SimulatorCard, index: number) {
    return (
      <article
        className="simulator-peek-card"
        draggable
        key={card.id}
        onContextMenu={(event) => openCardDrawer(event, card)}
        onTouchCancel={handleCardTouchEnd}
        onTouchEnd={handleCardTouchEnd}
        onTouchMove={handleCardTouchEnd}
        onTouchStart={(event) => handleCardTouchStart(event, card)}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-stacker-peek-index", String(index));
          setPeekDragIndex(index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const fromIndexValue = event.dataTransfer.getData("application/x-stacker-peek-index");
          const fromIndex = fromIndexValue ? Number(fromIndexValue) : peekDragIndex;

          if (fromIndex !== null && Number.isInteger(fromIndex) && fromIndex !== index) {
            reorderDeckTop(fromIndex, index);
          }

          setPeekDragIndex(null);
        }}
      >
        <span>{index === 0 ? "맨 위" : `${index + 1}번째`}</span>
        <div className="simulator-card-image">
          <CardImage src={card.imageUrl} alt={card.name} />
          <span className="simulator-card-cost-badge" data-cost-type="ACTIVE">
            {getActiveCost(card)}
          </span>
        </div>
        <strong>{card.name}</strong>
        <div className="simulator-peek-touch-controls">
          <button disabled={index === 0} onClick={() => reorderDeckTop(index, index - 1)} type="button">
            위
          </button>
          <button disabled={index >= deckPeekCards.length - 1} onClick={() => reorderDeckTop(index, index + 1)} type="button">
            아래
          </button>
        </div>
      </article>
    );
  }

  function renderFieldSlot(zoneId: "mainField" | "subField1" | "subField2" | "subField3", label: string) {
    const card = zones[zoneId][0] ?? null;

    return (
      <section
        className={`${getDropClass(zoneId, zoneId)} simulator-field-slot`}
        data-field-zone={zoneId}
        onClick={(event) => handleZoneBackgroundClick(event, zoneId)}
        onDragLeave={(event) => handleDragLeave(event, zoneId)}
        onDragOver={(event) => handleDragOver(event, zoneId, zoneId)}
        onDrop={(event) => handleDrop(event, zoneId)}
      >
        <span className="simulator-zone-label">{label}</span>
        {card ? renderFaceCard(card, true, zoneId) : <div className="simulator-empty-card">EMPTY</div>}
      </section>
    );
  }

  function renderCardDrawer() {
    if (!drawerCard) {
      return null;
    }

    const playableEffect = getPlayableEffectEntry(drawerCard);
    const compiledPlayableEffect = playableEffect?.text ? compileEffectText(playableEffect.text) : null;
    const choiceActionCount = compiledPlayableEffect?.actions.filter((action) => action.type === "chooseCards").length ?? 0;
    const inputActionCount =
      compiledPlayableEffect?.actions.filter((action) => action.type === "inputNumber" || action.type === "inputBoolean" || action.type === "inputCardType").length ?? 0;
    const automaticActionCount = compiledPlayableEffect ? compiledPlayableEffect.actions.length - choiceActionCount - inputActionCount : 0;
    const effectCost = getEffectCostValue(playableEffect?.cost);

    return (
      <div className="simulator-drawer-layer" onClick={() => setDrawerCard(null)}>
        <aside className="simulator-card-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="simulator-drawer-head">
            <div>
              <span>{drawerCard.collectionNumber}</span>
              <h2>{drawerCard.name}</h2>
            </div>
            <button aria-label="카드 정보 닫기" onClick={() => setDrawerCard(null)} type="button">
              ×
            </button>
          </div>

          <div className="simulator-drawer-image">
            <CardImage src={drawerCard.imageUrl} alt={drawerCard.name} />
          </div>

          <div className="simulator-drawer-meta">
            <span>{drawerCard.cardType}</span>
            <span>코스트 {getCardCost(drawerCard)}</span>
            {drawerCard.power !== null ? <span>파워 {drawerCard.power}</span> : null}
          </div>

          <div className="simulator-effect-list">
            {drawerCard.activeEffect ? (
              <section>
                <h3>액티브 효과 · {drawerCard.activeCost.trim() || "0"}</h3>
                <p>{drawerCard.activeEffect}</p>
              </section>
            ) : null}
            {drawerCard.mainEffect ? (
              <section>
                <h3>메인 효과 · {drawerCard.mainCost?.trim() || "0"}</h3>
                <p>{drawerCard.mainEffect}</p>
              </section>
            ) : null}
            {drawerCard.subEffect ? (
              <section>
                <h3>서브 효과 · {drawerCard.subCost?.trim() || "0"}</h3>
                <p>{drawerCard.subEffect}</p>
              </section>
            ) : null}
          </div>

          <div className="simulator-effect-runner">
            {playableEffect?.text && compiledPlayableEffect ? (
              <section>
                <div>
                  <strong>{playableEffect.label}</strong>
                  <span>
                    코스트 {effectCost} · 자동 {automaticActionCount} · 선택 {choiceActionCount} · 입력 {inputActionCount} · 수동{" "}
                    {compiledPlayableEffect.manualSteps.length}
                  </span>
                </div>
                <button onClick={() => activateDrawerCardEffect(drawerCard)} type="button">
                  효과 사용 <kbd>Space</kbd>
                </button>
                {compiledPlayableEffect.manualSteps.length > 0 ? (
                  <ul>
                    {compiledPlayableEffect.manualSteps.map((step, index) => (
                      <li key={`${playableEffect.label}-${index}`}>{step.reason}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : (
              <section>
                <div>
                  <strong>효과 발동</strong>
                  <span>현재 위치에서 발동 불가</span>
                </div>
                <p className="simulator-effect-runner-help">손패에서는 액티브 효과, 메인 필드에서는 메인 효과, 서브 필드에서는 서브 효과만 발동할 수 있습니다.</p>
              </section>
            )}
          </div>
        </aside>
      </div>
    );
  }

  function renderDeckPeekModal() {
    if (!deckPeekOpen) {
      return null;
    }

    return (
      <div className="simulator-modal-layer" onClick={() => setDeckPeekOpen(false)}>
        <section className="simulator-deck-peek-modal" onClick={(event) => event.stopPropagation()}>
          <div className="simulator-modal-head">
            <div>
              <span>DECK TOP</span>
              <h2>덱 위 3장</h2>
            </div>
            <button aria-label="덱 확인 닫기" onClick={() => setDeckPeekOpen(false)} type="button">
              ×
            </button>
          </div>

          {deckPeekCards.length > 0 ? (
            <div className="simulator-peek-list">{deckPeekCards.map((card, index) => renderPeekCard(card, index))}</div>
          ) : (
            <p className="simulator-empty-message">덱에 카드가 없습니다.</p>
          )}
        </section>
      </div>
    );
  }

  function renderPileOverlay() {
    if (!pileModalSource) {
      return null;
    }

    const sourceCards = zones[pileModalSource];
    const title = pileModalSource === "deck" ? "덱 전체" : "트래시 전체";
    const description = "카드를 드래그해서 원하는 영역으로 옮기세요.";

    return (
      <section className="simulator-field-pile-overlay">
        <div className="simulator-field-pile-head">
          <div>
            <span>{pileModalSource.toUpperCase()}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button aria-label={`${title} 닫기`} onClick={() => setPileModalSource(null)} type="button">
            ×
          </button>
        </div>

        {sourceCards.length > 0 ? (
          <div className="simulator-field-pile-grid">
            {sourceCards.map((card) => renderFaceCard(card, true, pileModalSource, undefined, undefined, true))}
          </div>
        ) : (
          <p className="simulator-empty-message">{pileModalSource === "deck" ? "덱" : "트래시"}에 카드가 없습니다.</p>
        )}
      </section>
    );
  }

  function renderPendingEffectChoiceOverlay() {
    if (!pendingEffectChoice) {
      return null;
    }

    const availableCards = getPendingEffectChoiceCards(pendingEffectChoice);
    const requiredCount = getPendingEffectChoiceRequiredCount(pendingEffectChoice);
    const isSelectionComplete = pendingEffectChoice.selectedIds.length === requiredCount;

    return (
      <section className="simulator-field-pile-overlay simulator-effect-choice-overlay">
        <div className="simulator-field-pile-head">
          <div>
            <span>CHOICE</span>
            <h2>{pendingEffectChoice.label}</h2>
            <p>
              {pendingEffectChoice.prompt} ({pendingEffectChoice.selectedIds.length}/{requiredCount})
            </p>
            {availableCards.length < pendingEffectChoice.count ? (
              <p>선택 가능한 카드가 부족해 가능한 수량만 처리합니다.</p>
            ) : null}
          </div>
          <button aria-label="선택 효과 닫기" onClick={() => setPendingEffectChoice(null)} type="button">
            ×
          </button>
        </div>

        {availableCards.length > 0 ? (
          <div className="simulator-field-pile-grid">
            {availableCards.map((card) => {
              const isSelected = pendingEffectChoice.selectedIds.includes(card.id);

              return (
                <button
                  className={isSelected ? "simulator-effect-choice-card selected" : "simulator-effect-choice-card"}
                  key={card.id}
                  onClick={() => togglePendingEffectChoiceCard(card.id)}
                  type="button"
                >
                  <div className="simulator-card-image">
                    <CardImage src={card.imageUrl} alt={card.name} />
                    <span className="simulator-card-cost-badge" data-cost-type="ACTIVE">
                      {getActiveCost(card)}
                    </span>
                  </div>
                  <strong>{card.name}</strong>
                  {isSelected ? <span className="simulator-effect-choice-check">선택됨</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="simulator-empty-message">선택 가능한 카드가 없습니다.</p>
        )}

        <div className="simulator-effect-choice-actions">
          <button disabled={!isSelectionComplete} onClick={resolvePendingEffectChoice} type="button">
            {requiredCount === 0 ? "처리 계속" : "선택 완료"}
          </button>
        </div>
      </section>
    );
  }

  function renderEffectInputModal() {
    if (!pendingEffectInput) {
      return null;
    }

    return (
      <div className="simulator-modal-layer simulator-effect-input-layer" onClick={() => setPendingEffectInput(null)}>
        <section className="simulator-effect-input-modal" onClick={(event) => event.stopPropagation()}>
          <div className="simulator-modal-head">
            <div>
              <span>INPUT</span>
              <h2>{pendingEffectInput.label}</h2>
              <p>{pendingEffectInput.prompt}</p>
            </div>
            <button aria-label="입력 모달 닫기" onClick={() => setPendingEffectInput(null)} type="button">
              ×
            </button>
          </div>

          {pendingEffectInput.type === "inputNumber" ? (
            <form
              className="simulator-effect-input-form"
              onSubmit={(event) => {
                event.preventDefault();
                resolvePendingEffectInput();
              }}
            >
              <label>
                <span>입력값</span>
                <input
                  autoFocus
                  min={pendingEffectInput.min ?? 0}
                  onChange={(event) =>
                    setPendingEffectInput((current) =>
                      current
                        ? {
                            ...current,
                            value: event.target.value,
                          }
                        : current,
                    )
                  }
                  step={1}
                  type="number"
                  value={pendingEffectInput.value}
                />
              </label>
              <button type="submit">입력 적용</button>
            </form>
          ) : pendingEffectInput.type === "inputCardType" ? (
            <div className="simulator-effect-input-actions" data-layout="three">
              {[
                { label: "액티브", value: "ACTIVE" },
                { label: "메인", value: "MAIN" },
                { label: "서브", value: "SUB" },
              ].map((option) => (
                <button autoFocus={option.value === "ACTIVE"} key={option.value} onClick={() => resolvePendingEffectInput(option.value)} type="button">
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="simulator-effect-input-actions">
              <button autoFocus onClick={() => resolvePendingEffectInput("true")} type="button">
                {pendingEffectInput.trueLabel ?? "예"}
              </button>
              <button onClick={() => resolvePendingEffectInput("false")} type="button">
                {pendingEffectInput.falseLabel ?? "아니오"}
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <section
      className="simulator-board compact-simulator-board"
      aria-label="덱 시뮬레이터"
      onContextMenuCapture={(event) => {
        if (!batchMove) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setBatchMove(null);
      }}
      onMouseMove={(event) => {
        if (!batchMove) {
          return;
        }

        setBatchMove((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current));
      }}
    >
      <div className="simulator-topbar">
        <div className="simulator-opponent-life">
          <span>상대 라이프</span>
          <strong>{opponentLife}</strong>
          <div className="simulator-counter-controls">
            <button aria-label="상대 라이프 5 감소" onClick={() => setOpponentLife((current) => Math.max(0, current - 5))} type="button">
              -5
            </button>
            <button aria-label="상대 라이프 1 감소" onClick={() => setOpponentLife((current) => Math.max(0, current - 1))} type="button">
              -
            </button>
            <button aria-label="상대 라이프 1 증가" onClick={() => setOpponentLife((current) => current + 1)} type="button">
              +
            </button>
            <button aria-label="상대 라이프 5 증가" onClick={() => setOpponentLife((current) => current + 5)} type="button">
              +5
            </button>
          </div>
        </div>

        <div className="simulator-action-row">
          <button className="button primary-button" disabled={zones.deck.length === 0} onClick={drawOneCard} type="button">
            드로우
          </button>
          <button className="button ghost-button" disabled={zones.deck.length < 2} onClick={shuffleDeck} type="button">
            셔플
          </button>
          <button className="button ghost-button" onClick={() => setIsFullscreen((current) => !current)} type="button">
            {isFullscreen ? "창모드" : "전체화면"}
          </button>
          <button className="button ghost-button" onClick={resetBoard} type="button">
            초기화
          </button>
        </div>
      </div>

      <div className="simulator-playmat">
        <section
          className={`${getDropClass("stack", "stack")} simulator-stack-zone`}
          onClick={(event) => handleZoneBackgroundClick(event, "stack")}
          onDragLeave={(event) => handleDragLeave(event, "stack")}
          onDragOver={(event) => handleDragOver(event, "stack", "stack")}
          onDrop={(event) => handleDrop(event, "stack")}
        >
          <span className="simulator-zone-label">스택</span>
          <div className="simulator-stack-buttons" onClick={(event) => event.stopPropagation()}>
            {[1, 2, 3, 4, 5].map((count) => (
              <button
                disabled={zones.stack.length < count}
                key={count}
                onClick={() => moveStackTopCardsToTrash(count)}
                type="button"
              >
                {count}
              </button>
            ))}
          </div>
          <div className="simulator-stack-list positioned-overlap" ref={stackListRef}>
            {zones.stack.map((card, index) =>
              renderFaceCard(card, true, "stack", getStackCardStyle(index), {
                onPointerEnter: (event) => handleOverlapPointerEnter(event, "stack", index),
                onPointerLeave: () => handleOverlapPointerLeave("stack"),
              }),
            )}
          </div>
        </section>

        <section
          className={`${getDropClass("mainField", "mainField")} simulator-main-field-zone`}
          onClick={(event) => handleZoneBackgroundClick(event, "mainField")}
          onDragLeave={(event) => handleDragLeave(event, "mainField")}
          onDragOver={(event) => handleDragOver(event, "mainField", "mainField")}
          onDrop={(event) => handleDrop(event, "mainField")}
        >
          <span className="simulator-zone-label">메인 필드</span>
          <div className="simulator-main-field-card">
            {zones.mainField[0] ? renderFaceCard(zones.mainField[0], true, "mainField") : <div className="simulator-empty-card">MAIN</div>}
          </div>
        </section>

        <section
          className={`${getDropClass("trash", "trash")} simulator-trash-zone`}
          onClick={(event) => handleZoneBackgroundClick(event, "trash")}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPileModalSource("trash");
          }}
          onDragLeave={(event) => handleDragLeave(event, "trash")}
          onDragOver={(event) => handleDragOver(event, "trash", "trash")}
          onDrop={(event) => handleDrop(event, "trash")}
        >
          <span className="simulator-zone-label">트래시</span>
          <div className="simulator-trash-card">
            {trashTopCard ? renderFaceCard(trashTopCard, true, "trash") : <div className="simulator-empty-card">TRASH</div>}
            {zones.trash.length > 1 ? <span className="simulator-pile-count">{zones.trash.length}</span> : null}
          </div>
        </section>

        {renderFieldSlot("subField1", "서브")}
        {renderFieldSlot("subField2", "서브")}
        {renderFieldSlot("subField3", "서브")}
        {renderPileOverlay()}
        {renderPendingEffectChoiceOverlay()}

        <div className="simulator-deck-bottom-zone">
          <button className="simulator-deck-peek-button" onClick={() => setDeckPeekOpen(true)} type="button">
            덱 확인
          </button>
          <div
            className={
              activeDropTarget === "deck-bottom"
                ? "simulator-deck-bottom-drop drop-active"
                : selectedCardId || draggedCardId || batchMove
                  ? "simulator-deck-bottom-drop drop-ready"
                  : "simulator-deck-bottom-drop"
            }
            onClick={(event) => handleZoneBackgroundClick(event, "deck", "bottom")}
            onDragLeave={(event) => handleDragLeave(event, "deck-bottom")}
            onDragOver={(event) => handleDragOver(event, "deck-bottom", "deck")}
            onDrop={(event) => handleDrop(event, "deck", "bottom")}
            role="button"
            tabIndex={0}
          >
            <strong>덱 아래</strong>
          </div>
        </div>

        <section
          className={`${getDropClass("hand", "hand")} simulator-hand-zone`}
          onClick={(event) => handleZoneBackgroundClick(event, "hand")}
          onDragLeave={(event) => handleDragLeave(event, "hand")}
          onDragOver={(event) => handleDragOver(event, "hand", "hand")}
          onDrop={(event) => handleDrop(event, "hand")}
        >
          <span className="simulator-zone-label">손패</span>
          <button className="simulator-mulligan-button" onClick={(event) => { event.stopPropagation(); mulliganHand(); }} type="button">
            멀리건
          </button>
          <div className="simulator-hand-list positioned-overlap" ref={handListRef}>
            {zones.hand.map((card, index) =>
              renderFaceCard(card, true, "hand", getHandCardStyle(index), {
                onPointerEnter: (event) => handleOverlapPointerEnter(event, "hand", index),
                onPointerLeave: () => handleOverlapPointerLeave("hand"),
              }),
            )}
          </div>
        </section>

        <section
          className={`${getDropClass("deck", "deck")} simulator-deck-stack-zone`}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPileModalSource("deck");
          }}
          onClick={(event) => handleZoneBackgroundClick(event, "deck", "top")}
          onDragLeave={(event) => handleDragLeave(event, "deck")}
          onDragOver={(event) => handleDragOver(event, "deck", "deck")}
          onDrop={(event) => handleDrop(event, "deck", "top")}
        >
          <span className="simulator-zone-label">덱</span>
          {deckTopCard ? (
            <article
              className="simulator-card-back"
              draggable
              onDragEnd={() => {
                setDraggedCardId(null);
                setActiveDropTarget(null);
              }}
              onDragStart={(event) => handleDragStart(event, deckTopCard)}
            >
              <span className="simulator-deck-count">{zones.deck.length}</span>
              <strong>STACKER</strong>
            </article>
          ) : (
            <div className="simulator-empty-card">DECK</div>
          )}
        </section>
      </div>

      {renderDeckPeekModal()}
      {renderCardDrawer()}
      {renderEffectInputModal()}
      {effectNotice ? (
        <div className="simulator-effect-notice">
          <span>{effectNotice}</span>
          <button aria-label="효과 처리 알림 닫기" onClick={() => setEffectNotice(null)} type="button">
            ×
          </button>
        </div>
      ) : null}
      {batchMove ? (
        <div className="simulator-batch-cursor" style={{ left: batchMove.x + 14, top: batchMove.y + 14 }}>
          ×{batchMove.count}
        </div>
      ) : null}
    </section>
  );
}
