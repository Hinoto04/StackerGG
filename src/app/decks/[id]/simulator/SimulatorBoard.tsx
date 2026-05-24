"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import { CardImage } from "@/components/CardImage";

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

export function SimulatorBoard({ cards, initialShuffleSeed, opponentLifeDefault }: SimulatorBoardProps) {
  const touchHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const stackListRef = useRef<HTMLDivElement | null>(null);
  const handListRef = useRef<HTMLDivElement | null>(null);
  const [zones, setZones] = useState<ZoneState>(() => createInitialZones(cards, (deckCards) => shuffleCardsWithSeed(deckCards, initialShuffleSeed)));
  const [cardVisualStates, setCardVisualStates] = useState<Record<string, CardVisualState>>(() => createInitialCardVisualStates(cards));
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
      if (event.key !== "Escape") {
        return;
      }

      setPileModalSource(null);
      setDeckPeekOpen(false);
      setBatchMove(null);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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

  function canMoveTo(card: SimulatorCard | null, targetZone: SimulatorZoneId) {
    if (!card) {
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
          [card.id]: { ...currentState, faceDown: false },
        };
      }

      return {
        ...current,
        [card.id]: { ...currentState, rotated: !currentState.rotated },
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
    setOpponentLife(opponentLifeDefault);
    setSelectedCardId(null);
    setDraggedCardId(null);
    setActiveDropTarget(null);
    setDeckPeekOpen(false);
    setDrawerCard(null);
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
      {batchMove ? (
        <div className="simulator-batch-cursor" style={{ left: batchMove.x + 14, top: batchMove.y + 14 }}>
          ×{batchMove.count}
        </div>
      ) : null}
    </section>
  );
}
