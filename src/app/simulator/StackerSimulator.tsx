"use client";

import { useMemo, useState } from "react";
import { CardImage } from "@/components/CardImage";
import { CARD_TYPES, type CardType } from "@/data/cards";

export type SimulatorCard = {
  id: string;
  name: string;
  cardType: CardType;
  power: number | null;
  activeCost: string;
  activeEffect: string;
  mainCost: string | null;
  mainEffect: string | null;
  subCost: string | null;
  subEffect: string | null;
  collectionNumber: string;
  tags: string;
  imageUrl: string;
};

export type SimulatorDeckItem = {
  id: string;
  slotType: CardType;
  quantity: number;
  displayOrder: number;
  isField: boolean;
  card: SimulatorCard;
};

export type SimulatorDeck = {
  id: string;
  name: string;
  authorName: string;
  items: SimulatorDeckItem[];
};

type CardInstance = {
  instanceId: string;
  card: SimulatorCard;
};

type FieldSlot = {
  instance: CardInstance | null;
  faceUp: boolean;
};

type PlayerState = {
  deckId: string;
  deckName: string;
  authorName: string;
  fieldMain: FieldSlot;
  fieldSubs: FieldSlot[];
  deck: CardInstance[];
  hand: CardInstance[];
  stack: CardInstance[];
  trash: CardInstance[];
  mainUsed: boolean;
  usedSubCardIds: string[];
  powerDelta: number;
  mulliganUsed: boolean;
};

type GamePhase = "SETUP" | "START" | "DRAW" | "MAIN" | "BATTLE" | "END";

type GameState = {
  activePlayer: 0 | 1;
  firstPlayer: 0 | 1;
  phase: GamePhase;
  players: [PlayerState, PlayerState];
  selectedCard: CardInstance | null;
  status: "setup" | "playing" | "finished";
  turnNumber: number;
  winner: 0 | 1 | null;
  log: string[];
};

const PHASE_LABELS: Record<GamePhase, string> = {
  SETUP: "준비",
  START: "스타트",
  DRAW: "드로우",
  MAIN: "메인",
  BATTLE: "배틀",
  END: "엔드",
};

const TYPE_LABELS: Record<CardType, string> = {
  MAIN: "메인",
  SUB: "서브",
  ACTIVE: "액티브",
};

const PLAYER_LABELS = ["P1", "P2"] as const;

function parseCost(cost: string | null) {
  const value = (cost ?? "").trim();
  const numeric = Number(value || "0");

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return Math.floor(numeric);
}

function getTypeCost(card: SimulatorCard) {
  if (card.cardType === "MAIN") {
    return card.mainCost || "0";
  }

  if (card.cardType === "SUB") {
    return card.subCost || "0";
  }

  return card.activeCost || "0";
}

function getTypeEffect(card: SimulatorCard) {
  if (card.cardType === "MAIN") {
    return card.mainEffect || "";
  }

  if (card.cardType === "SUB") {
    return card.subEffect || "";
  }

  return card.activeEffect || "";
}

function shuffle<T>(items: T[]) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function cloneGame(game: GameState) {
  return structuredClone(game) as GameState;
}

function sortDeckItems(items: SimulatorDeckItem[]) {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder || a.card.name.localeCompare(b.card.name, "ko-KR"));
}

function createInstances(deck: SimulatorDeck) {
  const instances: CardInstance[] = [];
  const counters = new Map<string, number>();

  for (const item of sortDeckItems(deck.items)) {
    for (let index = 0; index < item.quantity; index += 1) {
      const nextCount = (counters.get(item.card.id) ?? 0) + 1;
      counters.set(item.card.id, nextCount);
      instances.push({
        instanceId: `${item.card.id}-${nextCount}`,
        card: item.card,
      });
    }
  }

  return instances;
}

function takeFirstInstance(instances: CardInstance[], cardId: string) {
  const index = instances.findIndex((instance) => instance.card.id === cardId);

  if (index === -1) {
    return null;
  }

  const [instance] = instances.splice(index, 1);

  return instance;
}

function createPlayerState(deck: SimulatorDeck): PlayerState {
  const instances = createInstances(deck);
  const mainItems = sortDeckItems(deck.items.filter((item) => item.slotType === "MAIN"));
  const subItems = sortDeckItems(deck.items.filter((item) => item.slotType === "SUB"));
  const fieldMainItem = mainItems.find((item) => item.isField) ?? mainItems[0] ?? null;
  const fieldSubItems = subItems.filter((item) => item.isField).slice(0, 3);
  const fallbackSubItems = subItems.filter((item) => !fieldSubItems.some((fieldItem) => fieldItem.card.id === item.card.id));
  const selectedSubItems = [...fieldSubItems, ...fallbackSubItems].slice(0, 3);
  const fieldMain = fieldMainItem ? takeFirstInstance(instances, fieldMainItem.card.id) : null;
  const fieldSubs = selectedSubItems.map((item) => ({
    instance: takeFirstInstance(instances, item.card.id),
    faceUp: false,
  }));
  const player: PlayerState = {
    deckId: deck.id,
    deckName: deck.name,
    authorName: deck.authorName,
    fieldMain: {
      instance: fieldMain,
      faceUp: false,
    },
    fieldSubs,
    deck: shuffle(instances),
    hand: [],
    stack: [],
    trash: [],
    mainUsed: false,
    usedSubCardIds: [],
    powerDelta: 0,
    mulliganUsed: false,
  };

  drawCards(player, 4);

  return player;
}

function drawCards(player: PlayerState, count: number) {
  for (let index = 0; index < count; index += 1) {
    const card = player.deck.shift();

    if (!card) {
      return false;
    }

    player.hand.push(card);
  }

  return true;
}

function moveCardToTop(target: CardInstance[], card: CardInstance) {
  target.unshift(card);
}

function moveCardToBottom(target: CardInstance[], card: CardInstance) {
  target.push(card);
}

function pushLog(game: GameState, message: string) {
  game.log.unshift(`[${PLAYER_LABELS[game.activePlayer]} ${PHASE_LABELS[game.phase]}] ${message}`);
  game.log = game.log.slice(0, 80);
}

function getPlayerLabel(index: 0 | 1) {
  return PLAYER_LABELS[index];
}

function getOpponentIndex(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

function getCurrentPower(player: PlayerState) {
  const basePower = player.fieldMain.faceUp ? player.fieldMain.instance?.card.power ?? 0 : 0;

  return Math.max(0, basePower + player.powerDelta);
}

function payStackCost(player: PlayerState, cost: number) {
  if (player.stack.length < cost) {
    return false;
  }

  for (let index = 0; index < cost; index += 1) {
    const card = player.stack.shift();

    if (card) {
      moveCardToTop(player.trash, card);
    }
  }

  return true;
}

function getTags(tags: string) {
  return tags
    .split("/")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function CardFace({
  card,
  compact = false,
  faceDown = false,
  onClick,
}: {
  card?: SimulatorCard;
  compact?: boolean;
  faceDown?: boolean;
  onClick?: () => void;
}) {
  if (faceDown || !card) {
    return (
      <button className={compact ? "sim-card sim-card-compact sim-card-back" : "sim-card sim-card-back"} type="button" onClick={onClick}>
        <span>STACKER</span>
      </button>
    );
  }

  return (
    <button className={compact ? "sim-card sim-card-compact" : "sim-card"} type="button" onClick={onClick}>
      <div className="sim-card-image">
        <CardImage src={card.imageUrl} alt={card.name} />
      </div>
      <span>{card.name}</span>
    </button>
  );
}

function ZonePile({
  title,
  cards,
  emptyLabel,
  onCardClick,
}: {
  title: string;
  cards: CardInstance[];
  emptyLabel: string;
  onCardClick: (card: CardInstance) => void;
}) {
  const topCard = cards[0];

  return (
    <div className="sim-zone-pile">
      <div className="sim-zone-title">
        <span>{title}</span>
        <strong>{cards.length}</strong>
      </div>
      {topCard ? (
        <CardFace card={topCard.card} compact onClick={() => onCardClick(topCard)} />
      ) : (
        <div className="sim-empty-slot">{emptyLabel}</div>
      )}
    </div>
  );
}

function FieldArea({
  player,
  playerIndex,
  onSelectCard,
  onRevealSub,
}: {
  player: PlayerState;
  playerIndex: 0 | 1;
  onSelectCard: (card: CardInstance | null) => void;
  onRevealSub: (playerIndex: 0 | 1, slotIndex: number) => void;
}) {
  return (
    <div className="sim-field-area">
      <div className="sim-main-slot">
        <span>MAIN</span>
        <CardFace
          card={player.fieldMain.instance?.card}
          faceDown={!player.fieldMain.faceUp}
          onClick={() => onSelectCard(player.fieldMain.instance)}
        />
      </div>
      <div className="sim-sub-slots">
        {Array.from({ length: 3 }, (_, index) => {
          const slot = player.fieldSubs[index] ?? { instance: null, faceUp: false };

          return (
            <div className="sim-sub-slot" key={`${player.deckId}-sub-${index}`}>
              <span>SUB {index + 1}</span>
              <CardFace card={slot.instance?.card} faceDown={!slot.faceUp} onClick={() => onSelectCard(slot.instance)} />
              {slot.instance && !slot.faceUp ? (
                <button className="sim-inline-button" type="button" onClick={() => onRevealSub(playerIndex, index)}>
                  공개
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HandArea({
  cards,
  canUseActive,
  onActivate,
  onMoveToTrash,
  onSelectCard,
}: {
  cards: CardInstance[];
  canUseActive: boolean;
  onActivate: (instanceId: string) => void;
  onMoveToTrash: (instanceId: string) => void;
  onSelectCard: (card: CardInstance) => void;
}) {
  return (
    <div className="sim-hand-grid">
      {cards.length > 0 ? (
        cards.map((instance) => (
          <div className="sim-hand-card" key={instance.instanceId}>
            <CardFace card={instance.card} compact onClick={() => onSelectCard(instance)} />
            <div className="sim-hand-actions">
              <button type="button" disabled={!canUseActive || instance.card.cardType !== "ACTIVE"} onClick={() => onActivate(instance.instanceId)}>
                발동
              </button>
              <button type="button" onClick={() => onMoveToTrash(instance.instanceId)}>
                트래시
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="sim-empty-panel">패가 없습니다.</div>
      )}
    </div>
  );
}

function PlayerBoard({
  player,
  playerIndex,
  active,
  phase,
  onActivateActive,
  onAdjustPower,
  onMoveHandToTrash,
  onMoveTop,
  onRevealSub,
  onSelectCard,
}: {
  player: PlayerState;
  playerIndex: 0 | 1;
  active: boolean;
  phase: GamePhase;
  onActivateActive: (playerIndex: 0 | 1, instanceId: string) => void;
  onAdjustPower: (playerIndex: 0 | 1, amount: number) => void;
  onMoveHandToTrash: (playerIndex: 0 | 1, instanceId: string) => void;
  onMoveTop: (
    playerIndex: 0 | 1,
    from: "deck" | "stack" | "trash",
    to: "hand" | "stack" | "trash" | "deckTop" | "deckBottom",
  ) => void;
  onRevealSub: (playerIndex: 0 | 1, slotIndex: number) => void;
  onSelectCard: (card: CardInstance | null) => void;
}) {
  const currentPower = getCurrentPower(player);

  return (
    <section className={active ? "sim-player-board active-player" : "sim-player-board"}>
      <div className="sim-player-head">
        <div>
          <div className="kicker">{getPlayerLabel(playerIndex)}</div>
          <h2>{player.deckName}</h2>
          <span>{player.authorName}</span>
        </div>
        <div className="sim-player-metrics">
          <span>파워 {currentPower}</span>
          <span>덱 {player.deck.length}</span>
          <span>패 {player.hand.length}</span>
        </div>
      </div>

      <FieldArea player={player} playerIndex={playerIndex} onSelectCard={onSelectCard} onRevealSub={onRevealSub} />

      <div className="sim-zone-grid">
        <ZonePile title="덱" cards={player.deck} emptyLabel="DECK" onCardClick={onSelectCard} />
        <ZonePile title="스택" cards={player.stack} emptyLabel="STACK" onCardClick={onSelectCard} />
        <ZonePile title="트래시" cards={player.trash} emptyLabel="TRASH" onCardClick={onSelectCard} />
      </div>

      <div className="sim-quick-actions">
        <button type="button" onClick={() => onMoveTop(playerIndex, "deck", "hand")}>
          덱 → 패
        </button>
        <button type="button" onClick={() => onMoveTop(playerIndex, "deck", "stack")}>
          덱 → 스택
        </button>
        <button type="button" onClick={() => onMoveTop(playerIndex, "deck", "trash")}>
          덱 → 트래시
        </button>
        <button type="button" onClick={() => onMoveTop(playerIndex, "stack", "trash")}>
          스택 비용
        </button>
        <button type="button" onClick={() => onMoveTop(playerIndex, "trash", "hand")}>
          트래시 → 패
        </button>
        <button type="button" onClick={() => onMoveTop(playerIndex, "trash", "deckBottom")}>
          트래시 → 덱 아래
        </button>
        <button type="button" onClick={() => onAdjustPower(playerIndex, 1)}>
          파워 +1
        </button>
        <button type="button" onClick={() => onAdjustPower(playerIndex, -1)}>
          파워 -1
        </button>
      </div>

      <div className="sim-hand-section">
        <div className="sim-zone-title">
          <span>패</span>
          <strong>{player.hand.length}</strong>
        </div>
        <HandArea
          cards={player.hand}
          canUseActive={active && phase === "MAIN"}
          onActivate={(instanceId) => onActivateActive(playerIndex, instanceId)}
          onMoveToTrash={(instanceId) => onMoveHandToTrash(playerIndex, instanceId)}
          onSelectCard={onSelectCard}
        />
      </div>
    </section>
  );
}

function SelectedCardPanel({ card }: { card: CardInstance | null }) {
  if (!card) {
    return (
      <aside className="sim-selected-card">
        <div className="kicker">CARD</div>
        <h2>카드를 선택하세요</h2>
        <p>필드, 패, 스택, 트래시의 카드를 클릭하면 비용과 효과 텍스트를 여기에서 확인할 수 있습니다.</p>
      </aside>
    );
  }

  const tags = getTags(card.card.tags);

  return (
    <aside className="sim-selected-card">
      <div className="kicker">{card.card.cardType}</div>
      <h2>{card.card.name}</h2>
      {tags.length > 0 ? (
        <div className="card-tag-line">
          {tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      ) : null}
      <div className="sim-card-text-grid">
        {card.card.mainEffect ? (
          <div>
            <strong>메인 효과 ({card.card.mainCost || "0"})</strong>
            <p>{card.card.mainEffect}</p>
          </div>
        ) : null}
        {card.card.subEffect ? (
          <div>
            <strong>서브 효과 ({card.card.subCost || "0"})</strong>
            <p>{card.card.subEffect}</p>
          </div>
        ) : null}
        <div>
          <strong>액티브 효과 ({card.card.activeCost || "0"})</strong>
          <p>{card.card.activeEffect}</p>
        </div>
      </div>
    </aside>
  );
}

function createGame(decks: [SimulatorDeck, SimulatorDeck], firstPlayer: 0 | 1): GameState {
  return {
    activePlayer: firstPlayer,
    firstPlayer,
    phase: "SETUP",
    players: [createPlayerState(decks[0]), createPlayerState(decks[1])],
    selectedCard: null,
    status: "setup",
    turnNumber: 1,
    winner: null,
    log: ["게임 준비 완료: 멀리건을 진행한 뒤 게임 시작을 누르세요."],
  };
}

export function StackerSimulator({ decks }: { decks: SimulatorDeck[] }) {
  const [playerOneDeckId, setPlayerOneDeckId] = useState(decks[0]?.id ?? "");
  const [playerTwoDeckId, setPlayerTwoDeckId] = useState(decks[1]?.id ?? decks[0]?.id ?? "");
  const [firstPlayer, setFirstPlayer] = useState<0 | 1>(0);
  const [game, setGame] = useState<GameState | null>(null);
  const [sharedState, setSharedState] = useState("");
  const decksById = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks]);
  const canCreateGame = Boolean(decksById.get(playerOneDeckId) && decksById.get(playerTwoDeckId));

  function updateGame(mutator: (game: GameState) => void) {
    setGame((current) => {
      if (!current) {
        return current;
      }

      const next = cloneGame(current);
      mutator(next);
      return next;
    });
  }

  function handleCreateGame() {
    const p1Deck = decksById.get(playerOneDeckId);
    const p2Deck = decksById.get(playerTwoDeckId);

    if (!p1Deck || !p2Deck) {
      return;
    }

    setGame(createGame([p1Deck, p2Deck], firstPlayer));
  }

  function handleMulligan(playerIndex: 0 | 1) {
    updateGame((next) => {
      const player = next.players[playerIndex];

      if (player.mulliganUsed || next.status !== "setup") {
        return;
      }

      player.deck = shuffle([...player.deck, ...player.hand]);
      player.hand = [];
      player.mulliganUsed = true;
      drawCards(player, 4);
      pushLog(next, `${getPlayerLabel(playerIndex)} 멀리건`);
    });
  }

  function handleStartGame() {
    updateGame((next) => {
      next.status = "playing";
      next.phase = "START";
      next.players[0].fieldMain.faceUp = true;
      next.players[1].fieldMain.faceUp = true;
      pushLog(next, `게임 시작. 선공은 ${getPlayerLabel(next.firstPlayer)}`);
    });
  }

  function handleNextPhase() {
    updateGame((next) => {
      if (next.status !== "playing") {
        return;
      }

      if (next.phase === "START") {
        next.phase = "DRAW";
      } else if (next.phase === "DRAW") {
        next.phase = "MAIN";
      } else if (next.phase === "MAIN") {
        next.phase = "BATTLE";
      } else if (next.phase === "BATTLE") {
        next.phase = "END";
      } else if (next.phase === "END") {
        const previousPlayer = next.players[next.activePlayer];
        previousPlayer.mainUsed = false;
        previousPlayer.usedSubCardIds = [];
        next.players[0].powerDelta = 0;
        next.players[1].powerDelta = 0;
        next.activePlayer = getOpponentIndex(next.activePlayer);
        next.phase = "START";
        next.turnNumber += 1;
      }

      pushLog(next, `${PHASE_LABELS[next.phase]} 페이즈로 진행`);
    });
  }

  function handleDrawPhaseDraw() {
    updateGame((next) => {
      const player = next.players[next.activePlayer];
      const success = drawCards(player, 1);

      if (!success || player.deck.length === 0) {
        next.status = "finished";
        next.winner = getOpponentIndex(next.activePlayer);
        pushLog(next, `${getPlayerLabel(next.activePlayer)} 덱이 0장이 되어 패배`);
        return;
      }

      pushLog(next, `${getPlayerLabel(next.activePlayer)} 1장 드로우`);
    });
  }

  function handleRevealSub(playerIndex: 0 | 1, slotIndex: number) {
    updateGame((next) => {
      const slot = next.players[playerIndex].fieldSubs[slotIndex];

      if (!slot?.instance || slot.faceUp) {
        return;
      }

      slot.faceUp = true;
      pushLog(next, `${getPlayerLabel(playerIndex)} ${slot.instance.card.name} 공개`);
    });
  }

  function handleActivateMain() {
    updateGame((next) => {
      const player = next.players[next.activePlayer];
      const mainCard = player.fieldMain.instance?.card;

      if (!mainCard || !player.fieldMain.faceUp || player.mainUsed) {
        return;
      }

      const cost = parseCost(mainCard.mainCost);

      if (!payStackCost(player, cost)) {
        pushLog(next, `${mainCard.name} 메인 효과 비용 부족`);
        return;
      }

      player.mainUsed = true;
      pushLog(next, `${mainCard.name} 메인 효과 발동: ${mainCard.mainEffect || "효과 없음"}`);
    });
  }

  function handleActivateSub(instanceId: string) {
    updateGame((next) => {
      const player = next.players[next.activePlayer];
      const slot = player.fieldSubs.find((fieldSlot) => fieldSlot.instance?.instanceId === instanceId);
      const subCard = slot?.instance?.card;

      if (!slot?.faceUp || !subCard || player.usedSubCardIds.includes(subCard.id)) {
        return;
      }

      const cost = parseCost(subCard.subCost);

      if (!payStackCost(player, cost)) {
        pushLog(next, `${subCard.name} 서브 효과 비용 부족`);
        return;
      }

      player.usedSubCardIds.push(subCard.id);
      pushLog(next, `${subCard.name} 서브 효과 발동: ${subCard.subEffect || "효과 없음"}`);
    });
  }

  function handleActivateActive(playerIndex: 0 | 1, instanceId: string) {
    updateGame((next) => {
      const player = next.players[playerIndex];
      const handIndex = player.hand.findIndex((instance) => instance.instanceId === instanceId);
      const instance = player.hand[handIndex];

      if (handIndex === -1 || !instance || instance.card.cardType !== "ACTIVE" || next.activePlayer !== playerIndex || next.phase !== "MAIN") {
        return;
      }

      const cost = parseCost(instance.card.activeCost);

      if (!payStackCost(player, cost)) {
        pushLog(next, `${instance.card.name} 액티브 효과 비용 부족`);
        return;
      }

      player.hand.splice(handIndex, 1);
      moveCardToTop(player.stack, instance);
      pushLog(next, `${instance.card.name} 액티브 효과 발동: ${instance.card.activeEffect}`);
    });
  }

  function handleAttack() {
    updateGame((next) => {
      if (next.phase !== "BATTLE" || next.status !== "playing") {
        return;
      }

      if (next.turnNumber === 1 && next.activePlayer === next.firstPlayer) {
        pushLog(next, "선공 첫 턴에는 공격할 수 없습니다.");
        return;
      }

      const attacker = next.players[next.activePlayer];
      const defenderIndex = getOpponentIndex(next.activePlayer);
      const defender = next.players[defenderIndex];
      const damage = getCurrentPower(attacker);

      for (let index = 0; index < damage; index += 1) {
        const card = defender.deck.shift();

        if (card) {
          moveCardToTop(defender.trash, card);
        }
      }

      pushLog(next, `${getPlayerLabel(next.activePlayer)} 공격: ${getPlayerLabel(defenderIndex)} 덱 ${damage}장 트래시`);

      if (defender.deck.length === 0) {
        next.status = "finished";
        next.winner = next.activePlayer;
        pushLog(next, `${getPlayerLabel(defenderIndex)} 덱이 0장이 되어 패배`);
      } else {
        next.phase = "END";
      }
    });
  }

  function handleMoveTop(
    playerIndex: 0 | 1,
    from: "deck" | "stack" | "trash",
    to: "hand" | "stack" | "trash" | "deckTop" | "deckBottom",
  ) {
    updateGame((next) => {
      const player = next.players[playerIndex];
      const source = player[from];
      const card = source.shift();

      if (!card) {
        return;
      }

      if (to === "deckBottom") {
        moveCardToBottom(player.deck, card);
      } else if (to === "deckTop") {
        moveCardToTop(player.deck, card);
      } else if (to === "hand") {
        player.hand.push(card);
      } else {
        moveCardToTop(player[to], card);
      }

      pushLog(next, `${getPlayerLabel(playerIndex)} ${from} → ${to}: ${card.card.name}`);

      if (player.deck.length === 0 && from === "deck") {
        next.status = "finished";
        next.winner = getOpponentIndex(playerIndex);
        pushLog(next, `${getPlayerLabel(playerIndex)} 덱이 0장이 되어 패배`);
      }
    });
  }

  function handleMoveHandToTrash(playerIndex: 0 | 1, instanceId: string) {
    updateGame((next) => {
      const player = next.players[playerIndex];
      const handIndex = player.hand.findIndex((instance) => instance.instanceId === instanceId);
      const instance = player.hand[handIndex];

      if (!instance) {
        return;
      }

      player.hand.splice(handIndex, 1);
      moveCardToTop(player.trash, instance);
      pushLog(next, `${getPlayerLabel(playerIndex)} 패 → 트래시: ${instance.card.name}`);
    });
  }

  function handleAdjustPower(playerIndex: 0 | 1, amount: number) {
    updateGame((next) => {
      next.players[playerIndex].powerDelta += amount;
      pushLog(next, `${getPlayerLabel(playerIndex)} 파워 ${amount > 0 ? "+" : ""}${amount}`);
    });
  }

  function handleCopyState() {
    if (!game) {
      return;
    }

    const text = JSON.stringify(game);
    setSharedState(text);
    void navigator.clipboard?.writeText(text);
  }

  function handleLoadState() {
    try {
      const parsed = JSON.parse(sharedState) as GameState;

      if (!parsed.players || parsed.players.length !== 2) {
        throw new Error("Invalid state");
      }

      setGame(parsed);
    } catch {
      alert("시뮬레이터 상태 JSON을 확인해주세요.");
    }
  }

  const activePlayer = game?.players[game.activePlayer];
  const activeMain = activePlayer?.fieldMain.instance;
  const activeSubs = activePlayer?.fieldSubs.filter((slot) => slot.faceUp && slot.instance) ?? [];

  return (
    <div className="simulator-shell">
      <section className="simulator-setup-panel">
        <div className="simulator-select-grid">
          <label>
            <span>P1 덱</span>
            <select value={playerOneDeckId} onChange={(event) => setPlayerOneDeckId(event.target.value)}>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name} - {deck.authorName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>P2 덱</span>
            <select value={playerTwoDeckId} onChange={(event) => setPlayerTwoDeckId(event.target.value)}>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name} - {deck.authorName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>선공</span>
            <select value={firstPlayer} onChange={(event) => setFirstPlayer(Number(event.target.value) === 1 ? 1 : 0)}>
              <option value={0}>P1</option>
              <option value={1}>P2</option>
            </select>
          </label>
          <button className="button primary-button" type="button" disabled={!canCreateGame} onClick={handleCreateGame}>
            새 게임 준비
          </button>
        </div>

        <div className="sim-rule-note">
          <strong>자동 처리</strong>
          <span>필드 카드 배치, 4장 드로우, 페이즈 진행, 스택 비용 지불, 공격 대미지, 덱 0장 승패</span>
          <strong>수동 처리</strong>
          <span>자연어 카드 효과의 세부 대상 선택, 파워 변화, 회복/밀/서치 같은 효과 결과</span>
        </div>
      </section>

      {game ? (
        <>
          <section className="simulator-control-panel">
            <div>
              <div className="kicker">TURN CONTROL</div>
              <h2>
                {game.status === "finished"
                  ? `${getPlayerLabel(game.winner ?? 0)} 승리`
                  : `${getPlayerLabel(game.activePlayer)} ${PHASE_LABELS[game.phase]} 페이즈`}
              </h2>
              <p>
                턴 {game.turnNumber} · 선공 {getPlayerLabel(game.firstPlayer)}
              </p>
            </div>

            <div className="simulator-control-actions">
              {game.status === "setup" ? (
                <>
                  <button type="button" onClick={() => handleMulligan(0)} disabled={game.players[0].mulliganUsed}>
                    P1 멀리건
                  </button>
                  <button type="button" onClick={() => handleMulligan(1)} disabled={game.players[1].mulliganUsed}>
                    P2 멀리건
                  </button>
                  <button type="button" onClick={handleStartGame}>
                    게임 시작
                  </button>
                </>
              ) : null}
              {game.status === "playing" ? (
                <>
                  <button type="button" onClick={handleNextPhase}>
                    다음 페이즈
                  </button>
                  <button type="button" disabled={game.phase !== "DRAW"} onClick={handleDrawPhaseDraw}>
                    드로우 1
                  </button>
                  <button type="button" disabled={game.phase !== "MAIN" || !activeMain || activePlayer?.mainUsed} onClick={handleActivateMain}>
                    메인 효과
                  </button>
                  <button type="button" disabled={game.phase !== "BATTLE"} onClick={handleAttack}>
                    공격
                  </button>
                </>
              ) : null}
              <button type="button" onClick={handleCopyState}>
                상태 복사
              </button>
            </div>

            {game.status === "playing" && game.phase === "MAIN" && activeSubs.length > 0 ? (
              <div className="sim-sub-effect-actions">
                {activeSubs.map((slot) => {
                  const instance = slot.instance;

                  if (!instance) {
                    return null;
                  }

                  return (
                    <button
                      key={instance.instanceId}
                      type="button"
                      disabled={activePlayer?.usedSubCardIds.includes(instance.card.id)}
                      onClick={() => handleActivateSub(instance.instanceId)}
                    >
                      {instance.card.name} 서브 효과
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>

          <div className="simulator-board-grid">
            {game.players.map((player, index) => (
              <PlayerBoard
                active={game.activePlayer === index && game.status === "playing"}
                key={`${player.deckId}-${index}`}
                phase={game.phase}
                player={player}
                playerIndex={index as 0 | 1}
                onActivateActive={handleActivateActive}
                onAdjustPower={handleAdjustPower}
                onMoveHandToTrash={handleMoveHandToTrash}
                onMoveTop={handleMoveTop}
                onRevealSub={handleRevealSub}
                onSelectCard={(card) => updateGame((next) => void (next.selectedCard = card))}
              />
            ))}
          </div>

          <div className="simulator-bottom-grid">
            <SelectedCardPanel card={game.selectedCard} />

            <section className="sim-log-panel">
              <div className="section-heading">
                <div>
                  <div className="kicker">LOG</div>
                  <h2>진행 기록</h2>
                </div>
              </div>
              <div className="sim-log-list">
                {game.log.map((entry, index) => (
                  <span key={`${entry}-${index}`}>{entry}</span>
                ))}
              </div>
            </section>

            <section className="sim-share-panel">
              <div className="kicker">SHARE STATE</div>
              <h2>상태 공유</h2>
              <p>복사한 JSON을 다른 브라우저에 붙여넣으면 같은 게임 상태를 불러올 수 있습니다.</p>
              <textarea value={sharedState} onChange={(event) => setSharedState(event.target.value)} rows={7} />
              <div className="sim-share-actions">
                <button type="button" onClick={handleCopyState}>
                  현재 상태 넣기
                </button>
                <button type="button" onClick={handleLoadState}>
                  불러오기
                </button>
              </div>
            </section>
          </div>
        </>
      ) : (
        <section className="empty-panel">
          <strong>게임을 준비하세요.</strong>
          <p>두 플레이어의 덱과 선공을 선택한 뒤 새 게임 준비를 누르면 시뮬레이터가 초기 패와 필드를 생성합니다.</p>
        </section>
      )}
    </div>
  );
}
