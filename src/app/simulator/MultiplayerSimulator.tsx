"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { CardImage } from "@/components/CardImage";
import {
  SimulatorBoard,
  createInitialSimulatorSnapshot,
  type SimulatorBoardSnapshot,
  type SimulatorCard,
  type SimulatorZoneId,
} from "@/app/decks/[id]/simulator/SimulatorBoard";
import type { EffectAction } from "@/game/effectEngine";

export type MultiplayerDeckOption = {
  authorLabel: string;
  fieldMainCount: number;
  fieldReady: boolean;
  fieldSubCount: number;
  id: string;
  name: string;
};

type SessionRole = "player" | "spectator";
type DeckPlacement = "top" | "bottom";
type PileSource = "stack" | "trash";

type PublicCard = (SimulatorCard & { faceDown?: false }) | ({ faceDown: true; id: string } & Partial<SimulatorCard>);

type PublicSnapshot = {
  counts: {
    deck: number;
    hand: number;
    stack: number;
    trash: number;
  };
  opponentLife?: number;
  publicZones: {
    mainField: PublicCard[];
    stack: PublicCard[];
    stackTop?: PublicCard | null;
    subField1: PublicCard[];
    subField2: PublicCard[];
    subField3: PublicCard[];
    trash?: PublicCard[];
    trashTop: PublicCard | null;
  };
  updatedAt?: number;
};

type RoomLogEntry = {
  at: number;
  boardPlayerId?: string;
  currentPhaseLabel?: string;
  hideActor?: boolean;
  id: string;
  isNewTurn?: boolean;
  kind?: string;
  message: string;
  memoText?: string;
  nextPhaseLabel?: string;
  nextTurnPlayerId?: string;
  nextTurnPlayerName?: string;
  phasePlayerId?: string;
  phasePlayerName?: string;
  playerId: string;
  playerName: string;
  targetPlayerId?: string;
  targetPlayerName?: string;
  turnCount?: number;
};

type PlayerMemo = {
  authorName: string;
  authorPlayerId: string;
  createdAt: number;
  expiresAtTurnCount?: number;
  id: string;
  text: string;
};

type RoomPlayer = {
  connected: boolean;
  deckId: string;
  deckName: string;
  effectCostModifier?: number;
  effectCostModifierExpiresAtTurnCount?: number | null;
  effectCostModifierScope?: "all" | "main";
  joinedAt: number;
  memos?: PlayerMemo[];
  phaseIndex?: number;
  playerId: string;
  playerName: string;
  publicSnapshot?: PublicSnapshot | null;
  role: SessionRole;
  snapshot?: SimulatorBoardSnapshot | null;
  snapshotOrigin?: string | null;
  turnCount?: number;
};

type RoomState = {
  phaseIndex: number;
  turnCount: number;
  turnPlayerId: string | null;
  turnPlayerName?: string | null;
};

type RoomMessage =
  | {
      logs: RoomLogEntry[];
      players: RoomPlayer[];
      roomId: string;
      roomState?: RoomState;
      type: "room";
    }
  | {
      cards: SimulatorCard[];
      targetPlayerId: string;
      targetPlayerName: string;
      type: "peek";
    }
  | {
      message: string;
      type: "error";
    };

type DeckPayload = {
  cards: SimulatorCard[];
  deck: {
    id: string;
    name: string;
  };
  initialShuffleSeed: string;
};

type RecentSession = {
  deckId: string;
  deckName: string;
  playerId: string;
  playerName: string;
  roomId: string;
  savedAt: number;
};

type RemoteSelection = {
  cardId?: string;
  count?: number;
  sourceZone: SimulatorZoneId;
  targetPlayerId: string;
};

type PeekState = {
  cards: SimulatorCard[];
  targetPlayerId: string;
  targetPlayerName: string;
};

type PileState = {
  player: RoomPlayer;
  source: PileSource;
};

type ConnectionState = "idle" | "loading" | "connected" | "error";
type RemoteBatchCursor = {
  x: number;
  y: number;
};

const playerIdStorageKey = "stacker_multiplayer_player_id";
const recentSessionStorageKey = "stacker_multiplayer_recent_session";

const zoneLabels: Record<SimulatorZoneId, string> = {
  deck: "덱",
  hand: "손패",
  mainField: "MAIN",
  stack: "스택",
  subField1: "SUB 1",
  subField2: "SUB 2",
  subField3: "SUB 3",
  trash: "트래시",
};

const fieldZoneTypes: Partial<Record<SimulatorZoneId, SimulatorCard["cardType"]>> = {
  mainField: "MAIN",
  subField1: "SUB",
  subField2: "SUB",
  subField3: "SUB",
};

const turnPhases = [
  { id: "start", label: "스타트 페이즈" },
  { id: "draw", label: "드로우 페이즈" },
  { id: "main", label: "메인 페이즈" },
  { id: "battle", label: "배틀 페이즈" },
  { id: "end", label: "엔드 페이즈" },
] as const;

function getFirstPlayableDeckId(decks: MultiplayerDeckOption[]) {
  return decks.find((deck) => deck.fieldReady)?.id ?? "";
}

function getDeckFieldRequirementLabel(deck: MultiplayerDeckOption) {
  return `필드 MAIN ${deck.fieldMainCount}/1, SUB ${deck.fieldSubCount}/3`;
}

function createRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getWsUrl() {
  if (process.env.NEXT_PUBLIC_MULTIPLAYER_WS_URL) {
    return process.env.NEXT_PUBLIC_MULTIPLAYER_WS_URL;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3001`;
}

function getStoredPlayerId() {
  const existingId = window.localStorage.getItem(playerIdStorageKey);

  if (existingId) {
    return existingId;
  }

  const nextId = crypto.randomUUID();
  window.localStorage.setItem(playerIdStorageKey, nextId);
  return nextId;
}

function getRecentSession() {
  const rawSession = window.localStorage.getItem(recentSessionStorageKey);

  if (!rawSession) {
    return null;
  }

  try {
    return JSON.parse(rawSession) as RecentSession;
  } catch {
    window.localStorage.removeItem(recentSessionStorageKey);
    return null;
  }
}

function storeRecentSession(session: RecentSession) {
  window.localStorage.setItem(recentSessionStorageKey, JSON.stringify(session));
  window.localStorage.setItem(playerIdStorageKey, session.playerId);
}

function isEditableKeyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isPointInsideElement(event: Pick<globalThis.MouseEvent, "clientX" | "clientY">, element: HTMLElement | null) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function isInsideSimulatorModalSurface(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest(".simulator-deck-peek-modal, .simulator-field-pile-overlay, .simulator-effect-input-modal, .simulator-card-drawer"))
  );
}

function getCardFaceDown(snapshot: SimulatorBoardSnapshot | null | undefined, card: SimulatorCard | null | undefined, forceFaceUp = false) {
  if (!snapshot || !card || forceFaceUp) {
    return false;
  }

  return Boolean(snapshot.cardVisualStates?.[card.id]?.faceDown);
}

function parseRemoteDrag(event: DragEvent<HTMLElement>): RemoteSelection | null {
  const rawData = event.dataTransfer.getData("application/x-stacker-remote-card");

  if (!rawData) {
    return null;
  }

  try {
    return JSON.parse(rawData) as RemoteSelection;
  } catch {
    return null;
  }
}

function getCardCost(card: SimulatorCard) {
  if (card.cardType === "MAIN") {
    return card.mainCost?.trim() || "0";
  }

  if (card.cardType === "SUB") {
    return card.subCost?.trim() || "0";
  }

  return card.activeCost?.trim() || "0";
}

function getTurnPhase(phaseIndex?: number) {
  const normalizedIndex = Number.isInteger(phaseIndex) ? phaseIndex ?? 0 : 0;
  return turnPhases[((normalizedIndex % turnPhases.length) + turnPhases.length) % turnPhases.length];
}

function normalizeEffectTextForMatching(effectText: string) {
  return effectText.replace(/\s+/g, " ").trim();
}

function getOpponentEffectCostIncrease(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);

  if (!/상대/.test(normalizedText) || !/효과/.test(normalizedText) || !/코스트/.test(normalizedText) || !/(?:증가|올)/.test(normalizedText)) {
    return null;
  }

  const amountMatch = normalizedText.match(/코스트(?:를|가)?\s*(\d+)\s*(?:증가|올)/) ?? normalizedText.match(/(\d+)\s*(?:증가|올)/);
  return amountMatch ? Number(amountMatch[1]) : 1;
}

function requiresOpponentAttackExtraCost(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);
  return (
    /상대/.test(normalizedText) &&
    /공격/.test(normalizedText) &&
    /(?:코스트|비용|스택)/.test(normalizedText) &&
    /(?:추가|더|지불|트래시)/.test(normalizedText)
  );
}

function preventsOpponentAttack(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);
  return /다음\s*턴/.test(normalizedText) && /상대/.test(normalizedText) && /공격할 수 없/.test(normalizedText);
}

function preventsOpponentStackerActiveEffects(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);
  return /다음\s*턴/.test(normalizedText) && /상대/.test(normalizedText) && /액티브 효과/.test(normalizedText) && /발동할 수 없/.test(normalizedText);
}

function preventsOpponentEffectDamageToSelf(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);
  return /다음\s*턴/.test(normalizedText) && /상대.*발동.*효과/.test(normalizedText) && /자신.*받는\s*(?:대미지|데미지).*0/.test(normalizedText);
}

function grantsSelfDoubleAttack(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);
  return /자신/.test(normalizedText) && /공격/.test(normalizedText) && /(?:2|두)\s*번/.test(normalizedText);
}

function getNextOwnTurnMainPowerBoost(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);

  if (!/(?:다음\s*자신(?:의)?\s*턴|자신(?:의)?\s*다음\s*턴)/.test(normalizedText) || !/자신.*메인\s*스태커/.test(normalizedText) || !/(?:공격력|파워)/.test(normalizedText)) {
    return null;
  }

  if (!/(?:올|상승|증가)/.test(normalizedText)) {
    return null;
  }

  const amountMatch =
    normalizedText.match(/(?:공격력|파워)(?:를|가)?\s*(\d+)\s*(?:올|상승|증가)/) ??
    normalizedText.match(/(\d+)\s*(?:올|상승|증가)/);

  return amountMatch ? Number(amountMatch[1]) : null;
}

function getNextTurnOpponentMainPowerDecrease(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);

  if (!/다음\s*턴/.test(normalizedText) || !/상대.*메인\s*스태커/.test(normalizedText) || !/(?:공격력|파워)/.test(normalizedText)) {
    return null;
  }

  if (!/(?:감소|하락|내리|내려|[-−－]\s*\d+)/.test(normalizedText)) {
    return null;
  }

  const amountMatch =
    normalizedText.match(/(?:공격력|파워)(?:를|가)?\s*(\d+)\s*(?:감소|하락|내리|내려)/) ??
    normalizedText.match(/(\d+)\s*(?:감소|하락|내리|내려)/) ??
    normalizedText.match(/(?:공격력|파워)[^0-9-−－]*[-−－]\s*(\d+)/) ??
    normalizedText.match(/[-−－]\s*(\d+)/);

  return amountMatch ? Number(amountMatch[1]) : 1;
}

function getNextOwnMainEffectCostReduction(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);

  if (!/(?:다음\s*자신(?:의)?\s*턴|자신(?:의)?\s*다음\s*턴)/.test(normalizedText) || !/자신.*메인\s*효과/.test(normalizedText) || !/코스트/.test(normalizedText)) {
    return null;
  }

  if (!/(?:감소|내리|내려|낮)/.test(normalizedText)) {
    return null;
  }

  const amountMatch = normalizedText.match(/코스트(?:를|가)?\s*(\d+)\s*(?:감소|내리|내려|낮)/) ?? normalizedText.match(/(\d+)\s*(?:감소|내리|내려|낮)/);
  return amountMatch ? Number(amountMatch[1]) : 1;
}

function getNextOwnDrawPhaseMemos(effectText: string) {
  const normalizedText = normalizeEffectTextForMatching(effectText);
  const memos: Array<{ expiresAfterTurns: number; text: string }> = [];
  const hasNextOwnTurn = /(?:다음\s*자신(?:의)?\s*턴|자신(?:의)?\s*다음\s*턴)/.test(normalizedText);
  const hasFollowingOwnTurn = /그\s*다음\s*자신(?:의)?\s*턴/.test(normalizedText);

  if (!/드로우\s*페이즈/.test(normalizedText)) {
    return memos;
  }

  if (hasNextOwnTurn && /(?:추가\s*드로우|추가로?\s*\d+\s*장\s*드로우|\d+\s*장\s*추가)/.test(normalizedText)) {
    const amountMatch =
      normalizedText.match(/추가로?\s*(\d+)\s*장\s*드로우/) ??
      normalizedText.match(/(\d+)\s*장\s*추가/) ??
      normalizedText.match(/(\d+)\s*장\s*더/);
    const amount = amountMatch ? Number(amountMatch[1]) : 1;
    memos.push({ expiresAfterTurns: 2, text: `다음 자신의 드로우 페이즈에 ${amount}장 추가 드로우합니다.` });
  }

  if (hasNextOwnTurn && /스킵/.test(normalizedText) && !hasFollowingOwnTurn) {
    memos.push({ expiresAfterTurns: 2, text: "다음 자신의 드로우 페이즈를 스킵합니다." });
  }

  if (hasFollowingOwnTurn && /스킵/.test(normalizedText)) {
    memos.push({ expiresAfterTurns: 3, text: "그 다음 자신의 드로우 페이즈를 스킵합니다." });
  }

  return memos;
}

const defaultRoomState: RoomState = {
  phaseIndex: 0,
  turnCount: 1,
  turnPlayerId: null,
  turnPlayerName: null,
};

function RemoteCardPreview({
  card,
  displayPower,
  faceDown = false,
  label,
  onClick,
  onContextMenu,
  onDragStart,
  powerDelta = 0,
  selected = false,
}: {
  card?: SimulatorCard | null;
  displayPower?: number | null;
  faceDown?: boolean;
  label?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  powerDelta?: number;
  selected?: boolean;
}) {
  if (!card && !faceDown) {
    return <div className="multiplayer-remote-empty">EMPTY</div>;
  }

  const displayLabel = faceDown ? (label ?? "비공개 카드") : (card?.name ?? label ?? "");
  const handleContextMenu = faceDown
    ? (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
      }
    : onContextMenu;

  return (
    <article
      className={selected ? "multiplayer-remote-card selected" : "multiplayer-remote-card"}
      draggable={Boolean(onDragStart)}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onDragStart={onDragStart}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="multiplayer-remote-card-frame">
        {faceDown ? (
          <div className="multiplayer-card-back">
            <strong>STACKER</strong>
          </div>
        ) : card ? (
          <CardImage src={card.imageUrl} alt={card.name} />
        ) : null}
        {!faceDown && displayPower !== null && displayPower !== undefined ? (
          <span className="multiplayer-remote-power-badge" data-boosted={powerDelta > 0 ? "true" : undefined} data-reduced={powerDelta < 0 ? "true" : undefined}>
            {displayPower}
          </span>
        ) : null}
      </div>
      <span>{displayLabel}</span>
    </article>
  );
}

function RemoteZone({
  children,
  count,
  isActive,
  label,
  onClick,
  onContextMenu,
  onDropMove,
}: {
  children: ReactNode;
  count?: number;
  isActive?: boolean;
  label: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onDropMove?: (selection: RemoteSelection) => void;
}) {
  return (
    <section
      className={isActive ? "multiplayer-remote-zone drop-ready" : "multiplayer-remote-zone"}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={(event) => {
        if (!onDropMove || !parseRemoteDrag(event)) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        const selection = parseRemoteDrag(event);

        if (!selection || !onDropMove) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onDropMove(selection);
      }}
    >
      <span className="multiplayer-remote-zone-label">{label}</span>
      {typeof count === "number" ? <span className="multiplayer-remote-zone-count">{count}</span> : null}
      {children}
    </section>
  );
}

function PlayerStatusPanel({
  canControl,
  canEndPhase,
  isTurnPlayer,
  onAddMemo,
  onDeleteMemo,
  onPhaseEnd,
  player,
  roomState,
  selfPlayerId,
  showPhaseEndButton,
}: {
  canControl: boolean;
  canEndPhase: boolean;
  isTurnPlayer: boolean;
  onAddMemo: (targetPlayerId: string, text: string) => void;
  onDeleteMemo: (targetPlayerId: string, memoId: string) => void;
  onPhaseEnd: () => void;
  player: RoomPlayer;
  roomState: RoomState;
  selfPlayerId: string;
  showPhaseEndButton: boolean;
}) {
  const [memoText, setMemoText] = useState("");
  const currentPhase = getTurnPhase(roomState.phaseIndex);
  const nextPhase = getTurnPhase(roomState.phaseIndex + 1);
  const memos = player.memos ?? [];

  function submitMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextMemoText = memoText.trim();

    if (!nextMemoText || !canControl) {
      return;
    }

    onAddMemo(player.playerId, nextMemoText);
    setMemoText("");
  }

  return (
    <section className="multiplayer-player-status" data-turn-player={isTurnPlayer ? "true" : undefined} data-turn-waiting={!isTurnPlayer ? "true" : undefined}>
      <div className="multiplayer-phase-row" data-turn-waiting={!isTurnPlayer ? "true" : undefined}>
        {isTurnPlayer ? (
          <>
            <div>
              <span>TURN PLAYER</span>
              <strong>{`${roomState.turnCount}턴 진행 중`}</strong>
            </div>
            <div className="multiplayer-phase-badge">
              <span>현재</span>
              <strong>{currentPhase.label}</strong>
            </div>
            {showPhaseEndButton ? (
              <button disabled={!canEndPhase} onClick={onPhaseEnd} type="button">
                페이즈 종료
              </button>
            ) : null}
          </>
        ) : (
          <div className="multiplayer-turn-waiting">
            <strong>턴 대기중</strong>
          </div>
        )}
      </div>
      {isTurnPlayer ? <p className="multiplayer-phase-next">다음: {nextPhase.label}</p> : null}
      {(player.effectCostModifier ?? 0) !== 0 ? (
        <p className="multiplayer-phase-next">
          {player.effectCostModifierScope === "main" ? "메인 효과" : "효과"} 코스트{" "}
          {player.effectCostModifier && player.effectCostModifier > 0 ? `+${player.effectCostModifier}` : player.effectCostModifier}
          {player.effectCostModifierExpiresAtTurnCount ? ` · ${player.effectCostModifierExpiresAtTurnCount}번째 턴 종료 시 해제` : ""}
        </p>
      ) : null}

      <form className="multiplayer-memo-form" onSubmit={submitMemo}>
        <input
          disabled={!canControl}
          maxLength={240}
          onChange={(event) => setMemoText(event.target.value)}
          placeholder="다음 턴까지 사용 불가 등"
          type="text"
          value={memoText}
        />
        <button disabled={!canControl || !memoText.trim()} type="submit">
          메모
        </button>
      </form>

      {memos.length > 0 ? (
        <ul className="multiplayer-memo-list">
          {memos.map((memo) => {
            const authorRelation = memo.authorPlayerId === selfPlayerId ? "자신" : "상대";

            return (
              <li key={memo.id}>
                <p>{memo.text}</p>
                <span>
                  {memo.authorName}({authorRelation}) · {new Date(memo.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  {memo.expiresAtTurnCount ? ` · ${memo.expiresAtTurnCount}번째 턴 종료 시 삭제` : ""}
                </span>
                <button disabled={!canControl} onClick={() => onDeleteMemo(player.playerId, memo.id)} type="button">
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="multiplayer-memo-empty">메모 없음</p>
      )}
    </section>
  );
}

function PlayerMemoSection({
  canControl,
  onAddMemo,
  onDeleteMemo,
  player,
  selfPlayerId,
  title,
}: {
  canControl: boolean;
  onAddMemo: (targetPlayerId: string, text: string) => void;
  onDeleteMemo: (targetPlayerId: string, memoId: string) => void;
  player: RoomPlayer;
  selfPlayerId: string;
  title: string;
}) {
  const [memoText, setMemoText] = useState("");
  const memos = player.memos ?? [];

  function submitMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextMemoText = memoText.trim();

    if (!nextMemoText || !canControl) {
      return;
    }

    onAddMemo(player.playerId, nextMemoText);
    setMemoText("");
  }

  return (
    <section className="multiplayer-memo-section">
      <div className="multiplayer-memo-section-head">
        <span>{title}</span>
        <strong>{player.playerName}</strong>
      </div>

      <form className="multiplayer-memo-form" onSubmit={submitMemo}>
        <input
          disabled={!canControl}
          maxLength={240}
          onChange={(event) => setMemoText(event.target.value)}
          placeholder="메모 추가"
          type="text"
          value={memoText}
        />
        <button disabled={!canControl || !memoText.trim()} type="submit">
          메모
        </button>
      </form>

      {memos.length > 0 ? (
        <ul className="multiplayer-memo-list">
          {memos.map((memo) => {
            const authorRelation = memo.authorPlayerId === selfPlayerId ? "자신" : "상대";

            return (
              <li key={memo.id}>
                <p>{memo.text}</p>
                <span>
                  {memo.authorName}({authorRelation}) · {new Date(memo.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  {memo.expiresAtTurnCount ? ` · ${memo.expiresAtTurnCount}번째 턴 종료 시 삭제` : ""}
                </span>
                <button disabled={!canControl} onClick={() => onDeleteMemo(player.playerId, memo.id)} type="button">
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="multiplayer-memo-empty">메모 없음</p>
      )}
    </section>
  );
}

function MultiplayerMemoPanel({
  canControl,
  onAddMemo,
  onDeleteMemo,
  players,
  selfPlayerId,
}: {
  canControl: boolean;
  onAddMemo: (targetPlayerId: string, text: string) => void;
  onDeleteMemo: (targetPlayerId: string, memoId: string) => void;
  players: RoomPlayer[];
  selfPlayerId: string;
}) {
  return (
    <aside className="multiplayer-memo-panel">
      <div className="section-heading">
        <div>
          <div className="kicker">MEMOS</div>
          <h2>메모</h2>
        </div>
      </div>
      {players.length > 0 ? (
        players.map((player) => (
          <PlayerMemoSection
            canControl={canControl}
            key={player.playerId}
            onAddMemo={onAddMemo}
            onDeleteMemo={onDeleteMemo}
            player={player}
            selfPlayerId={selfPlayerId}
            title={player.playerId === selfPlayerId ? "자신" : "상대"}
          />
        ))
      ) : (
        <p className="multiplayer-memo-empty">메모를 확인할 플레이어가 없습니다.</p>
      )}
    </aside>
  );
}

function RemotePlayerBoard({
  canControl,
  canEndPhase,
  isTurnPlayer,
  onBatchCursorMove,
  onAddMemo,
  onDeleteMemo,
  onPhaseEnd,
  onOpenCard,
  onMove,
  onOpenPile,
  onPeekDeck,
  onPowerAdjust,
  onSelect,
  player,
  roomState,
  selection,
  selfPlayerId,
}: {
  canControl: boolean;
  canEndPhase: boolean;
  isTurnPlayer: boolean;
  onBatchCursorMove: (event: MouseEvent<HTMLElement>) => void;
  onAddMemo: (targetPlayerId: string, text: string) => void;
  onDeleteMemo: (targetPlayerId: string, memoId: string) => void;
  onPhaseEnd: () => void;
  onOpenCard: (card: SimulatorCard) => void;
  onMove: (payload: RemoteSelection & { deckPlacement?: DeckPlacement; targetZone: SimulatorZoneId }) => void;
  onOpenPile: (player: RoomPlayer, source: PileSource) => void;
  onPeekDeck: (player: RoomPlayer) => void;
  onPowerAdjust: (targetPlayerId: string, amount: number) => void;
  onSelect: (selection: RemoteSelection | null) => void;
  player: RoomPlayer;
  roomState: RoomState;
  selection: RemoteSelection | null;
  selfPlayerId: string;
}) {
  const snapshot = player.snapshot;
  const zones = snapshot?.zones;
  const stackTopCard = zones?.stack[0] ?? null;
  const trashTopCard = zones?.trash.at(-1) ?? null;
  const subFields: Array<"subField1" | "subField2" | "subField3"> = ["subField1", "subField2", "subField3"];

  function isSelected(sourceZone: SimulatorZoneId, cardId?: string) {
    return selection?.targetPlayerId === player.playerId && selection.sourceZone === sourceZone && selection.cardId === cardId;
  }

  function getZoneCount(sourceZone: SimulatorZoneId) {
    return zones?.[sourceZone]?.length ?? 0;
  }

  function getBatchSelectionCount(sourceZone: SimulatorZoneId) {
    if (selection?.targetPlayerId !== player.playerId || selection.sourceZone !== sourceZone || selection.cardId) {
      return undefined;
    }

    return selection.count ?? 1;
  }

  function getCardPowerDelta(card?: SimulatorCard | null) {
    if (!card) {
      return 0;
    }

    return snapshot?.powerModifiers?.[card.id] ?? 0;
  }

  function getDisplayPower(card?: SimulatorCard | null) {
    if (!card || card.power === null || card.power === undefined) {
      return null;
    }

    return card.power + getCardPowerDelta(card);
  }

  function findSelectionCard() {
    if (!selection?.cardId || selection.targetPlayerId !== player.playerId || !zones) {
      return null;
    }

    return zones[selection.sourceZone]?.find((card) => card.id === selection.cardId) ?? null;
  }

  function canMoveSelectionTo(targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    if (!selection || selection.targetPlayerId !== player.playerId) {
      return false;
    }

    if (selection.sourceZone === targetZone && !(targetZone === "deck" && deckPlacement === "bottom")) {
      return false;
    }

    const requiredType = fieldZoneTypes[targetZone];

    if (!requiredType || !selection.cardId) {
      return true;
    }

    return findSelectionCard()?.cardType === requiredType;
  }

  function startOrIncrementBatchSelection(sourceZone: SimulatorZoneId, event?: MouseEvent<HTMLElement>) {
    if (!canControl) {
      return;
    }

    const sourceCount = getZoneCount(sourceZone);

    if (sourceCount === 0) {
      return;
    }

    if (event) {
      onBatchCursorMove(event);
    }

    const nextCount =
      selection?.targetPlayerId === player.playerId && selection.sourceZone === sourceZone && !selection.cardId
        ? Math.min(sourceCount, (selection.count ?? 1) + 1)
        : 1;

    onSelect({
      count: nextCount,
      sourceZone,
      targetPlayerId: player.playerId,
    });
  }

  function selectCard(sourceZone: SimulatorZoneId, card?: SimulatorCard | null, event?: MouseEvent<HTMLElement>) {
    if (!canControl) {
      return;
    }

    if (selection?.targetPlayerId === player.playerId) {
      if (selection.cardId && card?.id === selection.cardId) {
        onSelect(null);
        return;
      }

      if (!selection.cardId && !card && selection.sourceZone === sourceZone) {
        startOrIncrementBatchSelection(sourceZone, event);
        return;
      }

      moveSelected(sourceZone);
      return;
    }

    if (!card) {
      startOrIncrementBatchSelection(sourceZone, event);
      return;
    }

    onSelect({
      cardId: card?.id,
      sourceZone,
      targetPlayerId: player.playerId,
    });
  }

  function createDragStart(sourceZone: SimulatorZoneId, card?: SimulatorCard | null) {
    if (!canControl) {
      return undefined;
    }

    return (event: DragEvent<HTMLElement>) => {
      const selectedBatchCount =
        selection?.targetPlayerId === player.playerId && selection.sourceZone === sourceZone && !selection.cardId ? selection.count : undefined;
      const payload: RemoteSelection = {
        cardId: card?.id,
        count: card ? undefined : selectedBatchCount ?? 1,
        sourceZone,
        targetPlayerId: player.playerId,
      };

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-stacker-remote-card", JSON.stringify(payload));
      onSelect(payload);
    };
  }

  function handleRemoteZoneClick(event: MouseEvent<HTMLElement>, targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    if (!canControl) {
      return;
    }

    if (!selection || selection.targetPlayerId !== player.playerId) {
      startOrIncrementBatchSelection(targetZone, event);
      return;
    }

    if (selection.sourceZone === targetZone && !selection.cardId) {
      startOrIncrementBatchSelection(targetZone, event);
      return;
    }

    if (selection.sourceZone === targetZone && selection.cardId) {
      onSelect(null);
      return;
    }

    moveSelected(targetZone, deckPlacement);
  }

  function moveSelected(targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    if (!selection || selection.targetPlayerId !== player.playerId) {
      return;
    }

    if (!canMoveSelectionTo(targetZone, deckPlacement)) {
      onSelect(null);
      return;
    }

    onMove({
      ...selection,
      deckPlacement,
      targetZone,
    });
    onSelect(null);
  }

  function dropMove(targetZone: SimulatorZoneId, deckPlacement: DeckPlacement = "bottom") {
    return (dragSelection: RemoteSelection) => {
      if (dragSelection.targetPlayerId !== player.playerId) {
        return;
      }

      onMove({
        ...dragSelection,
        deckPlacement,
        targetZone,
      });
      onSelect(null);
    };
  }

  function handleRemoteBoardClick() {
    if (selection?.targetPlayerId === player.playerId && selection.cardId) {
      onSelect(null);
    }
  }

  function openCardDetail(event: MouseEvent<HTMLElement>, card?: SimulatorCard | null) {
    if (!card) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpenCard(card);
  }

  return (
    <section className="multiplayer-remote-board" data-turn-player={isTurnPlayer ? "true" : undefined} onClick={handleRemoteBoardClick}>
      <div className="section-heading">
        <div>
          <div className="kicker">
            {player.role === "spectator" ? "SPECTATOR" : player.connected ? "OPPONENT" : "DISCONNECTED"}
          </div>
          <h2>{player.playerName}</h2>
        </div>
      </div>

      <PlayerStatusPanel
        canControl={canControl}
        canEndPhase={canEndPhase}
        isTurnPlayer={isTurnPlayer}
        onAddMemo={onAddMemo}
        onDeleteMemo={onDeleteMemo}
        onPhaseEnd={onPhaseEnd}
        player={player}
        roomState={roomState}
        selfPlayerId={selfPlayerId}
        showPhaseEndButton={false}
      />

      {zones ? (
        <>
          <div className="multiplayer-remote-grid">
            <RemoteZone
              count={zones.stack.length}
              isActive={selection?.targetPlayerId === player.playerId}
              label="스택"
              onClick={(event) => handleRemoteZoneClick(event, "stack")}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenPile(player, "stack");
              }}
              onDropMove={dropMove("stack")}
            >
              <RemoteCardPreview
                card={stackTopCard}
                onClick={(event) => {
                  event.stopPropagation();
                  selectCard("stack", stackTopCard, event);
                }}
                onDragStart={createDragStart("stack", stackTopCard)}
                selected={isSelected("stack", stackTopCard?.id) || Boolean(getBatchSelectionCount("stack"))}
              />
            </RemoteZone>

            <RemoteZone
              count={zones.mainField.length}
              isActive={selection?.targetPlayerId === player.playerId}
              label="MAIN"
              onClick={(event) => handleRemoteZoneClick(event, "mainField")}
              onDropMove={dropMove("mainField")}
            >
              <RemoteCardPreview
                card={zones.mainField[0]}
                displayPower={getDisplayPower(zones.mainField[0])}
                faceDown={getCardFaceDown(snapshot, zones.mainField[0])}
                onClick={(event) => {
                  event.stopPropagation();
                  selectCard("mainField", zones.mainField[0], event);
                }}
                onContextMenu={(event) => openCardDetail(event, zones.mainField[0])}
                onDragStart={createDragStart("mainField", zones.mainField[0])}
                powerDelta={getCardPowerDelta(zones.mainField[0])}
                selected={isSelected("mainField", zones.mainField[0]?.id) || Boolean(getBatchSelectionCount("mainField"))}
              />
              <div className="multiplayer-remote-power-controls" onClick={(event) => event.stopPropagation()}>
                <button disabled={!canControl || !zones.mainField[0]} onClick={() => onPowerAdjust(player.playerId, -1)} type="button">
                  -
                </button>
                <button disabled={!canControl || !zones.mainField[0]} onClick={() => onPowerAdjust(player.playerId, 1)} type="button">
                  +
                </button>
              </div>
            </RemoteZone>

            <RemoteZone
              count={zones.trash.length}
              isActive={selection?.targetPlayerId === player.playerId}
              label="트래시"
              onClick={(event) => handleRemoteZoneClick(event, "trash")}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenPile(player, "trash");
              }}
              onDropMove={dropMove("trash")}
            >
              <RemoteCardPreview
                card={trashTopCard}
                onClick={(event) => {
                  event.stopPropagation();
                  selectCard("trash", trashTopCard, event);
                }}
                onDragStart={createDragStart("trash", trashTopCard)}
                selected={isSelected("trash", trashTopCard?.id) || Boolean(getBatchSelectionCount("trash"))}
              />
            </RemoteZone>

            {subFields.map((zoneId, index) => {
              const card = zones[zoneId][0] ?? null;

              return (
                <RemoteZone
                  count={zones[zoneId].length}
                  isActive={selection?.targetPlayerId === player.playerId}
                  key={zoneId}
                  label={`SUB ${index + 1}`}
                  onClick={(event) => handleRemoteZoneClick(event, zoneId)}
                  onDropMove={dropMove(zoneId)}
                >
                  <RemoteCardPreview
                    card={card}
                    faceDown={getCardFaceDown(snapshot, card)}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectCard(zoneId, card, event);
                    }}
                    onContextMenu={(event) => openCardDetail(event, card)}
                    onDragStart={createDragStart(zoneId, card)}
                    selected={isSelected(zoneId, card?.id) || Boolean(getBatchSelectionCount(zoneId))}
                  />
                </RemoteZone>
              );
            })}

            <RemoteZone
              count={zones.hand.length}
              isActive={selection?.targetPlayerId === player.playerId}
              label="손패"
              onClick={(event) => handleRemoteZoneClick(event, "hand")}
              onDropMove={dropMove("hand")}
            >
              <RemoteCardPreview
                card={zones.hand[0]}
                faceDown={zones.hand.length > 0}
                label="손패"
                onClick={(event) => {
                  event.stopPropagation();
                  selectCard("hand", undefined, event);
                }}
                onContextMenu={(event) => openCardDetail(event, zones.hand[0])}
                onDragStart={zones.hand.length > 0 ? createDragStart("hand") : undefined}
                selected={isSelected("hand") || Boolean(getBatchSelectionCount("hand"))}
              />
            </RemoteZone>

            <RemoteZone
              count={zones.deck.length}
              isActive={selection?.targetPlayerId === player.playerId}
              label="덱"
              onClick={(event) => handleRemoteZoneClick(event, "deck", "top")}
              onDropMove={dropMove("deck", "top")}
            >
              <RemoteCardPreview
                card={zones.deck[0]}
                faceDown={zones.deck.length > 0}
                label="덱 맨 위"
                onClick={(event) => {
                  event.stopPropagation();
                  selectCard("deck", undefined, event);
                }}
                onContextMenu={(event) => openCardDetail(event, zones.deck[0])}
                onDragStart={zones.deck.length > 0 ? createDragStart("deck") : undefined}
                selected={isSelected("deck") || Boolean(getBatchSelectionCount("deck"))}
              />
            </RemoteZone>

            <div className="multiplayer-remote-deck-tools">
              <button disabled={!canControl || zones.deck.length === 0} onClick={() => onPeekDeck(player)} type="button">
                덱 확인
              </button>
              <button
                aria-disabled={!canControl}
                className="multiplayer-remote-deck-bottom-drop"
                onClick={() => {
                  if (canControl) {
                    moveSelected("deck", "bottom");
                  }
                }}
                onDragOver={(event) => {
                  if (!canControl || !parseRemoteDrag(event)) {
                    return;
                  }

                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  const dragSelection = parseRemoteDrag(event);

                  if (!canControl || !dragSelection) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  dropMove("deck", "bottom")(dragSelection);
                }}
                type="button"
              >
                덱 아래
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="multiplayer-help-text">{player.connected ? "게임 준비가 완료되었습니다. 보드 상태를 동기화하는 중입니다." : "상대가 보드를 준비하고 있습니다."}</p>
      )}
    </section>
  );
}

function RemotePileModal({
  onClose,
  onOpenCard,
  onMove,
  onSelect,
  pile,
  selection,
}: {
  onClose: () => void;
  onOpenCard: (card: SimulatorCard) => void;
  onMove: (payload: RemoteSelection & { deckPlacement?: DeckPlacement; targetZone: SimulatorZoneId }) => void;
  onSelect: (selection: RemoteSelection | null) => void;
  pile: PileState | null;
  selection: RemoteSelection | null;
}) {
  const activePile = pile;

  const pileSnapshot = activePile?.player.snapshot;

  if (!activePile || !pileSnapshot) {
    return null;
  }

  const pilePlayer = activePile.player;
  const pileSource = activePile.source;
  const cards = pileSnapshot.zones[pileSource];
  const displayCards = pileSource === "trash" ? [...cards].reverse() : cards;
  const title = `${pilePlayer.playerName} ${zoneLabels[pileSource]}`;

  function handleCardSelection(card: SimulatorCard) {
    if (selection?.targetPlayerId === pilePlayer.playerId) {
      if (selection.cardId === card.id) {
        onSelect(null);
        onClose();
        return;
      }

      if (selection.sourceZone === pileSource) {
        onSelect(null);
        onClose();
        return;
      }

      onMove({
        ...selection,
        targetZone: pileSource,
      });
      onSelect(null);
      onClose();
      return;
    }

    onSelect({
      cardId: card.id,
      sourceZone: pileSource,
      targetPlayerId: pilePlayer.playerId,
    });
    onClose();
  }

  return (
    <section className="simulator-field-pile-overlay multiplayer-remote-overlay" onClick={(event) => event.stopPropagation()}>
      <div className="simulator-field-pile-head">
        <div>
          <span>{pileSource.toUpperCase()}</span>
          <h2>{title}</h2>
        </div>
        <button aria-label={`${title} 닫기`} onClick={onClose} type="button">
          ×
        </button>
      </div>

      {displayCards.length > 0 ? (
        <div className="simulator-field-pile-grid">
          {displayCards.map((card, index) => {
            const pileOrderIndex = index;

            return (
              <button
                aria-label={`${pilePlayer.playerName} ${zoneLabels[pileSource]} ${pileOrderIndex + 1}번째 카드 ${card.name}`}
                className="multiplayer-remote-pile-card"
                data-pile-order={pileOrderIndex < 5 ? String(pileOrderIndex + 1) : undefined}
                key={card.id}
                onClick={() => {
                  handleCardSelection(card);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenCard(card);
                }}
                type="button"
              >
                <CardImage src={card.imageUrl} alt={card.name} />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="simulator-empty-message">카드가 없습니다.</p>
      )}
    </section>
  );
}

function PeekModal({
  onClose,
  onOpenCard,
  onMove,
  onSelect,
  peek,
  selection,
}: {
  onClose: () => void;
  onOpenCard: (card: SimulatorCard) => void;
  onMove: (payload: RemoteSelection & { deckPlacement?: DeckPlacement; targetZone: SimulatorZoneId }) => void;
  onSelect: (selection: RemoteSelection | null) => void;
  peek: PeekState | null;
  selection: RemoteSelection | null;
}) {
  const activePeek = peek;

  if (!activePeek) {
    return null;
  }

  const targetPlayerId = activePeek.targetPlayerId;
  const targetPlayerName = activePeek.targetPlayerName;
  const peekCards = activePeek.cards;

  function handleCardSelection(card: SimulatorCard) {
    if (selection?.targetPlayerId === targetPlayerId) {
      if (selection.cardId === card.id) {
        onSelect(null);
        onClose();
        return;
      }

      if (selection.sourceZone === "deck") {
        onSelect(null);
        onClose();
        return;
      }

      onMove({
        ...selection,
        deckPlacement: "top",
        targetZone: "deck",
      });
      onSelect(null);
      onClose();
      return;
    }

    onSelect({
      cardId: card.id,
      sourceZone: "deck",
      targetPlayerId,
    });
    onClose();
  }

  return (
    <div className="simulator-modal-layer">
      <section className="simulator-deck-peek-modal" onClick={(event) => event.stopPropagation()}>
        <div className="simulator-modal-head">
          <div>
            <span>DECK TOP</span>
            <h2>{targetPlayerName} 덱 위 3장</h2>
          </div>
          <button aria-label="덱 확인 닫기" onClick={onClose} type="button">
            ×
          </button>
        </div>

        {peekCards.length > 0 ? (
          <div className="simulator-peek-list">
            {peekCards.map((card, index) => (
              <article
                className="simulator-peek-card"
                key={card.id}
                onClick={() => {
                  handleCardSelection(card);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenCard(card);
                }}
              >
                <span>{index === 0 ? "맨 위" : `${index + 1}번째`}</span>
                <div className="simulator-card-image">
                  <CardImage src={card.imageUrl} alt={card.name} />
                </div>
                <strong>{card.name}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="simulator-empty-message">덱에 카드가 없습니다.</p>
        )}
      </section>
    </div>
  );
}

function RemoteCardDrawer({ card, onClose }: { card: SimulatorCard | null; onClose: () => void }) {
  if (!card) {
    return null;
  }

  return (
    <div className="simulator-drawer-layer" onClick={onClose}>
      <aside className="simulator-card-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="simulator-drawer-head">
          <div>
            <span>{card.collectionNumber}</span>
            <h2>{card.name}</h2>
          </div>
          <button aria-label="카드 정보 닫기" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="simulator-drawer-image">
          <CardImage src={card.imageUrl} alt={card.name} />
        </div>

        <div className="simulator-drawer-meta">
          <span>{card.cardType}</span>
          <span>코스트 {getCardCost(card)}</span>
          {card.power !== null ? <span>파워 {card.power}</span> : null}
        </div>

        <div className="simulator-effect-list">
          {card.activeEffect ? (
            <section data-effect-kind="active">
              <h3>액티브 효과 · {card.activeCost.trim() || "0"}</h3>
              <p>{card.activeEffect}</p>
            </section>
          ) : null}
          {card.mainEffect ? (
            <section data-effect-kind="main">
              <h3>메인 효과 · {card.mainCost?.trim() || "0"}</h3>
              <p>{card.mainEffect}</p>
            </section>
          ) : null}
          {card.subEffect ? (
            <section data-effect-kind="sub">
              <h3>서브 효과 · {card.subCost?.trim() || "0"}</h3>
              <p>{card.subEffect}</p>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function SessionLogPanel({
  chatMessage,
  isOpen,
  logs,
  onChatMessageChange,
  onClose,
  onSubmitChat,
  selfPlayerId,
}: {
  chatMessage: string;
  isOpen: boolean;
  logs: RoomLogEntry[];
  onChatMessageChange: (message: string) => void;
  onClose: () => void;
  onSubmitChat: (event: FormEvent<HTMLFormElement>) => void;
  selfPlayerId: string;
}) {
  function getPlayerRelation(playerId?: string) {
    return playerId === selfPlayerId ? "자신" : "상대";
  }

  function getLogMessage(log: RoomLogEntry) {
    if (log.kind === "memoAdd") {
      const memoText = log.memoText?.trim() || log.message;
      return `메모 추가: ${memoText}`;
    }

    if (log.kind === "memoDelete") {
      return "메모를 삭제했습니다.";
    }

    if (log.kind === "phaseEnd") {
      const currentPhase = log.currentPhaseLabel ?? "페이즈";
      const nextPhase = log.nextPhaseLabel ?? "다음 페이즈";

      if (log.isNewTurn) {
        const nextPlayerRelation = getPlayerRelation(log.nextTurnPlayerId ?? log.boardPlayerId);
        return `${currentPhase} -> ${nextPlayerRelation} ${nextPhase}`;
      }

      return `${currentPhase} -> ${nextPhase}`;
    }

    return log.message;
  }

  function getLogSide(log: RoomLogEntry) {
    const boardPlayerId = log.boardPlayerId ?? log.playerId;

    if (boardPlayerId === "system" || log.playerId === "system") {
      return "system";
    }

    return boardPlayerId === selfPlayerId ? "self" : "opponent";
  }

  return (
    <aside aria-hidden={!isOpen} className={isOpen ? "multiplayer-log-drawer open" : "multiplayer-log-drawer"}>
      <div className="section-heading">
        <div>
          <div className="kicker">LOG</div>
          <h2>세션 로그</h2>
        </div>
        <button aria-label="로그 닫기" onClick={onClose} type="button">
          ×
        </button>
      </div>
      {logs.length > 0 ? (
        <ol>
          {[...logs.slice(-50)].reverse().map((log) => {
            const logMessage = getLogMessage(log);
            const isCompactMessage = log.kind === "memoAdd";

            return (
              <li data-side={getLogSide(log)} key={log.id}>
                <time>{new Date(log.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>
                <span className={isCompactMessage ? "multiplayer-log-message compact" : "multiplayer-log-message"} title={isCompactMessage ? logMessage : undefined}>
                  {logMessage}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="multiplayer-help-text">아직 기록된 행동이 없습니다.</p>
      )}
      <form className="multiplayer-chat-form" onSubmit={onSubmitChat}>
        <input
          maxLength={120}
          onChange={(event) => onChatMessageChange(event.target.value)}
          placeholder="채팅 입력"
          type="text"
          value={chatMessage}
        />
        <button disabled={!chatMessage.trim()} type="submit">
          전송
        </button>
      </form>
    </aside>
  );
}

export function MultiplayerSimulator({ decks, initialPlayerName }: { decks: MultiplayerDeckOption[]; initialPlayerName: string }) {
  const [roomId, setRoomId] = useState(() => createRoomCode());
  const [playerName, setPlayerName] = useState(initialPlayerName);
  const [selectedDeckId, setSelectedDeckId] = useState(() => getFirstPlayableDeckId(decks));
  const [cards, setCards] = useState<SimulatorCard[]>([]);
  const [deckName, setDeckName] = useState("");
  const [initialShuffleSeed, setInitialShuffleSeed] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [roomLogs, setRoomLogs] = useState<RoomLogEntry[]>([]);
  const [roomState, setRoomState] = useState<RoomState>(defaultRoomState);
  const [playerId, setPlayerId] = useState("");
  const [recentSession, setRecentSession] = useState<RecentSession | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<SimulatorBoardSnapshot | null>(null);
  const [externalSnapshot, setExternalSnapshot] = useState<SimulatorBoardSnapshot | null>(null);
  const [remoteSelection, setRemoteSelection] = useState<RemoteSelection | null>(null);
  const [peekState, setPeekState] = useState<PeekState | null>(null);
  const [pileState, setPileState] = useState<PileState | null>(null);
  const [remoteDrawerCard, setRemoteDrawerCard] = useState<SimulatorCard | null>(null);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [myRole, setMyRole] = useState<SessionRole>("player");
  const [remoteBatchCursor, setRemoteBatchCursor] = useState<RemoteBatchCursor | null>(null);
  const initialRoomSnapshotHandledRef = useRef(false);
  const latestSnapshotRef = useRef<SimulatorBoardSnapshot | null>(null);
  const playLayoutRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const selectedDeck = useMemo(() => decks.find((deck) => deck.id === selectedDeckId) ?? null, [decks, selectedDeckId]);
  const hasPlayableDeck = useMemo(() => decks.some((deck) => deck.fieldReady), [decks]);
  const selectedDeckFieldMessage = selectedDeck && !selectedDeck.fieldReady ? getDeckFieldRequirementLabel(selectedDeck) : "";
  const deckAvailabilityMessage = selectedDeckFieldMessage || (!hasPlayableDeck ? "멀티 시뮬레이터에서는 필드 MAIN 1장과 SUB 3장이 준비된 덱만 사용할 수 있습니다." : "");
  const selfPlayer = useMemo(() => roomPlayers.find((player) => player.playerId === playerId) ?? null, [playerId, roomPlayers]);
  const activeRoomPlayers = useMemo(() => roomPlayers.filter((player) => player.role === "player"), [roomPlayers]);
  const remotePlayers = useMemo(() => activeRoomPlayers.filter((player) => player.playerId !== playerId), [activeRoomPlayers, playerId]);
  const memoPlayers = useMemo(() => [selfPlayer, ...remotePlayers].filter((player): player is RoomPlayer => Boolean(player)), [remotePlayers, selfPlayer]);
  const primaryRemotePlayer = remotePlayers[0] ?? null;
  const primaryRemoteMainPower = useMemo(() => {
    const snapshot = primaryRemotePlayer?.snapshot;
    const mainCard = snapshot?.zones.mainField[0] ?? null;

    if (!mainCard || mainCard.power === null || mainCard.power === undefined) {
      return null;
    }

    return mainCard.power + Number(snapshot?.powerModifiers?.[mainCard.id] ?? 0);
  }, [primaryRemotePlayer]);
  const opponentDeckCount = primaryRemotePlayer?.snapshot?.zones.deck.length ?? primaryRemotePlayer?.publicSnapshot?.counts.deck ?? 0;
  const spectatorCount = useMemo(() => roomPlayers.filter((player) => player.role === "spectator").length, [roomPlayers]);
  const isGameReady = activeRoomPlayers.length >= 2 && activeRoomPlayers.every((player) => player.connected && player.snapshot);
  const canConnect = Boolean(playerId && selectedDeckId && selectedDeck?.fieldReady && roomId.trim() && playerName.trim());
  const canControlRemote = connectionState === "connected" && myRole === "player";
  const canEndPhase = connectionState === "connected" && myRole === "player" && roomState.turnPlayerId === playerId;
  const remoteBatchSelection = remoteSelection && !remoteSelection.cardId ? remoteSelection : null;

  useEffect(() => {
    setPlayerId(getStoredPlayerId());
    setRecentSession(getRecentSession());

    return () => {
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (selectedDeckId && selectedDeck?.fieldReady) {
      return;
    }

    const nextDeckId = getFirstPlayableDeckId(decks);

    if (nextDeckId !== selectedDeckId) {
      setSelectedDeckId(nextDeckId);
    }
  }, [decks, selectedDeck?.fieldReady, selectedDeckId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.repeat || isEditableKeyTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setIsLogDrawerOpen((current) => !current);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || (!peekState && !pileState && !remoteDrawerCard && !remoteSelection)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      setPeekState(null);
      setPileState(null);
      setRemoteDrawerCard(null);
      setRemoteSelection(null);
      setRemoteBatchCursor(null);
    }

    window.addEventListener("keydown", handleEscape, true);

    return () => {
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [peekState, pileState, remoteDrawerCard, remoteSelection]);

  useEffect(() => {
    const hasOpenRemoteModal = Boolean(peekState || pileState);
    const hasRemoteMoveAttempt = Boolean(remoteSelection);

    if (!hasOpenRemoteModal && !hasRemoteMoveAttempt) {
      return;
    }

    function isPointInsideGameBoard(event: Pick<globalThis.MouseEvent, "clientX" | "clientY">) {
      const playLayout = playLayoutRef.current;

      if (!playLayout) {
        return false;
      }

      const boardElements = playLayout.querySelectorAll<HTMLElement>(".multiplayer-opponent-panel, .multiplayer-board-panel");

      return Array.from(boardElements).some((element) => isPointInsideElement(event, element));
    }

    function clearRemoteMoveAttempt() {
      setRemoteSelection(null);
      setRemoteBatchCursor(null);
    }

    function closeRemoteModals() {
      setPeekState(null);
      setPileState(null);
    }

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (event.button !== 0 || isPointInsideGameBoard(event) || isInsideSimulatorModalSurface(event.target)) {
        return;
      }

      if (hasOpenRemoteModal) {
        closeRemoteModals();
      }

      if (hasRemoteMoveAttempt) {
        clearRemoteMoveAttempt();
      }
    }

    function handleContextMenu(event: globalThis.MouseEvent) {
      const isInsideGameBoard = isPointInsideGameBoard(event);
      const shouldCloseRemoteModal = hasOpenRemoteModal && !isInsideGameBoard && !isInsideSimulatorModalSurface(event.target);

      if (!hasRemoteMoveAttempt && !shouldCloseRemoteModal) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (hasRemoteMoveAttempt) {
        clearRemoteMoveAttempt();
      }

      if (shouldCloseRemoteModal) {
        closeRemoteModals();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, [peekState, pileState, remoteSelection]);

  useEffect(() => {
    if (!remoteBatchSelection) {
      setRemoteBatchCursor(null);
    }
  }, [remoteBatchSelection]);

  function sendSocketMessage(payload: unknown) {
    const socket = socketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  const sendActionLog = useCallback((message: string) => {
    sendSocketMessage({
      message,
      type: "log",
    });
  }, []);

  function submitChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = chatMessage.trim();

    if (!message) {
      return;
    }

    sendActionLog(`채팅: ${message}`);
    setChatMessage("");
  }

  const handleSnapshotChange = useCallback((snapshot: SimulatorBoardSnapshot) => {
    latestSnapshotRef.current = snapshot;
    sendSocketMessage({
      snapshot,
      type: "state",
    });
  }, []);

  async function loadDeck(deckId: string) {
    const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/simulator-cards`);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (payload?.message) {
        throw new Error(payload.message);
      }

      throw new Error("덱 데이터를 불러오지 못했습니다.");
    }

    return (await response.json()) as DeckPayload;
  }

  async function connectToRoom(options?: { recent?: RecentSession }) {
    const session = options?.recent;
    const targetRoomId = (session?.roomId ?? roomId).trim().toUpperCase();
    const targetPlayerName = (session?.playerName ?? playerName).trim();
    const targetPlayerId = session?.playerId ?? playerId;
    const targetDeckId = session?.deckId ?? selectedDeck?.id;

    if (!targetRoomId || !targetPlayerName || !targetPlayerId || !targetDeckId) {
      return;
    }

    const targetDeck = decks.find((deck) => deck.id === targetDeckId) ?? selectedDeck;

    if (targetDeck && !targetDeck.fieldReady) {
      setConnectionState("error");
      setStatusMessage(`멀티 시뮬레이터에서는 ${getDeckFieldRequirementLabel(targetDeck)} 준비가 필요합니다.`);
      return;
    }

    setConnectionState("loading");
    setStatusMessage("덱을 불러오는 중입니다.");
    setRoomId(targetRoomId);
    setPlayerName(targetPlayerName);
    setPlayerId(targetPlayerId);
    setSelectedDeckId(targetDeckId);
    setInitialSnapshot(null);
    setExternalSnapshot(null);
    setRemoteSelection(null);
    setPeekState(null);
    setPileState(null);
    setRoomPlayers([]);
    setRoomLogs([]);
    setRoomState(defaultRoomState);
    initialRoomSnapshotHandledRef.current = false;
    latestSnapshotRef.current = null;
    socketRef.current?.close();

    try {
      const deckPayload = await loadDeck(targetDeckId);
      const initialBoardSnapshot = createInitialSimulatorSnapshot(deckPayload.cards, deckPayload.initialShuffleSeed, 25);
      const socket = new WebSocket(getWsUrl());

      setCards(deckPayload.cards);
      setDeckName(deckPayload.deck.name);
      setInitialShuffleSeed(deckPayload.initialShuffleSeed);
      setInitialSnapshot(initialBoardSnapshot);
      latestSnapshotRef.current = initialBoardSnapshot;
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setConnectionState("connected");
        setStatusMessage("방에 연결되었습니다.");
        socket.send(
          JSON.stringify({
            deckId: deckPayload.deck.id,
            deckName: deckPayload.deck.name,
            playerId: targetPlayerId,
            playerName: targetPlayerName,
            roomId: targetRoomId,
            snapshot: initialBoardSnapshot,
            type: "join",
          }),
        );

        storeRecentSession({
          deckId: deckPayload.deck.id,
          deckName: targetDeck?.name ?? deckPayload.deck.name,
          playerId: targetPlayerId,
          playerName: targetPlayerName,
          roomId: targetRoomId,
          savedAt: Date.now(),
        });
        setRecentSession(getRecentSession());
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as RoomMessage;

        if (message.type === "room") {
          setRoomPlayers(message.players);
          setRoomLogs(message.logs ?? []);
          setRoomState(message.roomState ?? defaultRoomState);

          const nextSelf = message.players.find((player) => player.playerId === targetPlayerId);

          if (nextSelf) {
            setMyRole(nextSelf.role);

            if (nextSelf.role === "spectator") {
              setStatusMessage("플레이어 자리가 가득 차 관전자로 입장했습니다.");
            }

            if (nextSelf.role === "player" && nextSelf.snapshot && !initialRoomSnapshotHandledRef.current) {
              initialRoomSnapshotHandledRef.current = true;
              setInitialSnapshot(nextSelf.snapshot);
              latestSnapshotRef.current = nextSelf.snapshot;
            } else if (nextSelf.role === "player" && nextSelf.snapshot && nextSelf.snapshotOrigin && nextSelf.snapshotOrigin !== targetPlayerId) {
              setExternalSnapshot({
                ...nextSelf.snapshot,
                updatedAt: Date.now(),
              });
              latestSnapshotRef.current = nextSelf.snapshot;
            }
          }
          return;
        }

        if (message.type === "peek") {
          setPeekState({
            cards: message.cards,
            targetPlayerId: message.targetPlayerId,
            targetPlayerName: message.targetPlayerName,
          });
          return;
        }

        if (message.type === "error") {
          setConnectionState((current) => (current === "connected" ? current : "error"));
          setStatusMessage(message.message);
        }
      });

      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) {
          return;
        }

        setConnectionState((current) => (current === "connected" ? "idle" : current));
        setStatusMessage("연결이 종료되었습니다. 최근 세션으로 다시 접속할 수 있습니다.");
      });

      socket.addEventListener("error", () => {
        if (socketRef.current !== socket) {
          return;
        }

        setConnectionState("error");
        setStatusMessage("WebSocket 서버에 연결하지 못했습니다.");
      });
    } catch (error) {
      setConnectionState("error");
      setStatusMessage(error instanceof Error ? error.message : "연결 준비 중 오류가 발생했습니다.");
    }
  }

  function leaveRoom() {
    socketRef.current?.close();
    socketRef.current = null;
    setConnectionState("idle");
    setRoomPlayers([]);
    setRoomLogs([]);
    setRoomState(defaultRoomState);
    setCards([]);
    setInitialSnapshot(null);
    setExternalSnapshot(null);
    setRemoteSelection(null);
    setStatusMessage("방에서 나왔습니다.");
  }

  function moveRemoteCard(payload: RemoteSelection & { deckPlacement?: DeckPlacement; targetZone: SimulatorZoneId }) {
    sendSocketMessage({
      ...payload,
      type: "remoteMove",
    });
  }

  function updateRemoteBatchCursor(event: MouseEvent<HTMLElement>) {
    setRemoteBatchCursor({
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleOpponentActions(actions: EffectAction[], effectLabel: string) {
    const targetPlayer = primaryRemotePlayer;

    if (!targetPlayer) {
      sendActionLog(`${effectLabel}: 처리할 상대 플레이어가 없습니다.`);
      return;
    }

    for (const action of actions) {
      if (action.type === "damageOpponent" && action.amount > 0) {
        moveRemoteCard({
          count: action.amount,
          sourceZone: "deck",
          targetPlayerId: targetPlayer.playerId,
          targetZone: "trash",
        });
        continue;
      }

      if (action.type === "changeOpponentLife" && action.amount !== 0) {
        const isDeckGain = action.amount > 0;

        moveRemoteCard({
          count: Math.abs(action.amount),
          deckPlacement: isDeckGain ? "bottom" : undefined,
          sourceZone: isDeckGain ? "trash" : "deck",
          targetPlayerId: targetPlayer.playerId,
          targetZone: isDeckGain ? "deck" : "trash",
        });
        continue;
      }

      if (action.type === "moveOpponentTop" && action.count > 0) {
        const targetZone: SimulatorZoneId = action.to === "deckBottom" ? "deck" : action.to;

        moveRemoteCard({
          count: action.count,
          deckPlacement: action.to === "deckBottom" ? "bottom" : undefined,
          sourceZone: action.from,
          targetPlayerId: targetPlayer.playerId,
          targetZone,
        });
        continue;
      }

      if (action.type === "modifyOpponentMainPower" && action.amount !== 0) {
        adjustPlayerMainPower(targetPlayer.playerId, action.amount);
      }
    }
  }

  function peekRemoteDeck(player: RoomPlayer) {
    sendSocketMessage({
      targetPlayerId: player.playerId,
      type: "remotePeek",
    });
  }

  function endPlayerPhase() {
    sendSocketMessage({
      type: "phaseEnd",
    });
  }

  function addPlayerMemo(targetPlayerId: string, text: string, options?: { expiresAfterTurns?: number }) {
    sendSocketMessage({
      expiresAfterTurns: options?.expiresAfterTurns,
      targetPlayerId,
      text,
      type: "memoAdd",
    });
  }

  function deletePlayerMemo(targetPlayerId: string, memoId: string) {
    sendSocketMessage({
      memoId,
      targetPlayerId,
      type: "memoDelete",
    });
  }

  function changePlayerEffectCost(targetPlayerId: string, amount: number, memoText: string, scope: "all" | "main" = "all", expiresAfterTurns = 1) {
    sendSocketMessage({
      amount,
      expiresAfterTurns,
      memoText,
      scope,
      targetPlayerId,
      type: "effectCostModifierAdd",
    });
  }

  function schedulePlayerEffectCost(targetPlayerId: string, amount: number, memoText: string, scope: "all" | "main" = "all") {
    sendSocketMessage({
      amount,
      scope,
      targetPlayerId,
      text: memoText,
      type: "scheduleEffectCostModifier",
    });
  }

  function scheduleMainPowerBoost(targetPlayerId: string, amount: number, cardName: string) {
    sendSocketMessage({
      amount,
      targetPlayerId,
      text: `${cardName}: 다음 자신의 턴 시작 시 메인 스태커 공격력 +${amount}`,
      type: "scheduleMainPowerBoost",
    });
  }

  function modifyPlayerMainPower(targetPlayerId: string, amount: number, memoText: string) {
    sendSocketMessage({
      amount,
      expiresAfterTurns: 1,
      memoText,
      targetPlayerId,
      type: "mainPowerModifierAdd",
    });
  }

  function adjustPlayerMainPower(targetPlayerId: string, amount: number) {
    sendSocketMessage({
      amount,
      targetPlayerId,
      type: "mainPowerModifierAdjust",
    });
  }

  function noteOncePerTurnEffectUse(cardName: string, effectLabel: string) {
    const targetPlayerId = selfPlayer?.playerId ?? playerId;

    if (!targetPlayerId) {
      return;
    }

    addPlayerMemo(targetPlayerId, `한 턴 1회: ${cardName} 사용 (${effectLabel})`, { expiresAfterTurns: 1 });
  }

  function handleTurnLimitedEffectUse({ cardName, effectText }: { cardName: string; effectLabel: string; effectText: string }) {
    const opponentPlayerId = primaryRemotePlayer?.playerId;
    const selfPlayerId = selfPlayer?.playerId ?? playerId;

    const opponentEffectCostIncrease = getOpponentEffectCostIncrease(effectText);

    if (opponentPlayerId && opponentEffectCostIncrease !== null && opponentEffectCostIncrease > 0) {
      changePlayerEffectCost(opponentPlayerId, opponentEffectCostIncrease, `${cardName}: 이번 턴 효과 코스트 +${opponentEffectCostIncrease}`);
    }

    if (opponentPlayerId && requiresOpponentAttackExtraCost(effectText)) {
      addPlayerMemo(opponentPlayerId, `${cardName}: 공격할 때 추가 비용을 지불해야 합니다.`, { expiresAfterTurns: 1 });
    }

    if (opponentPlayerId && preventsOpponentAttack(effectText)) {
      addPlayerMemo(opponentPlayerId, `${cardName}: 다음 턴 공격할 수 없습니다.`, { expiresAfterTurns: 1 });
    }

    if (opponentPlayerId && preventsOpponentStackerActiveEffects(effectText)) {
      addPlayerMemo(opponentPlayerId, `${cardName}: 다음 턴 메인/서브 스태커의 액티브 효과를 발동할 수 없습니다.`, { expiresAfterTurns: 1 });
    }

    if (opponentPlayerId && preventsOpponentEffectDamageToSelf(effectText)) {
      addPlayerMemo(opponentPlayerId, `${cardName}: 다음 턴 상대에게 주는 효과 대미지가 0이 됩니다.`, { expiresAfterTurns: 1 });
    }

    const opponentMainPowerDecrease = getNextTurnOpponentMainPowerDecrease(effectText);

    if (opponentPlayerId && opponentMainPowerDecrease !== null && opponentMainPowerDecrease > 0) {
      modifyPlayerMainPower(opponentPlayerId, -opponentMainPowerDecrease, `${cardName}: 다음 턴 종료 시까지 메인 스태커 공격력 -${opponentMainPowerDecrease}`);
    }

    if (selfPlayerId && grantsSelfDoubleAttack(effectText)) {
      addPlayerMemo(selfPlayerId, `${cardName}: 이번 턴 두 번 공격할 수 있습니다.`, { expiresAfterTurns: 1 });
    }

    const nextTurnMainPowerBoost = getNextOwnTurnMainPowerBoost(effectText);

    if (selfPlayerId && nextTurnMainPowerBoost !== null && nextTurnMainPowerBoost > 0) {
      scheduleMainPowerBoost(selfPlayerId, nextTurnMainPowerBoost, cardName);
    }

    const mainEffectCostReduction = getNextOwnMainEffectCostReduction(effectText);

    if (selfPlayerId && mainEffectCostReduction !== null && mainEffectCostReduction > 0) {
      schedulePlayerEffectCost(selfPlayerId, -mainEffectCostReduction, `${cardName}: 다음 자신의 턴 메인 효과 코스트 -${mainEffectCostReduction}`, "main");
    }

    for (const memo of getNextOwnDrawPhaseMemos(effectText)) {
      if (selfPlayerId) {
        addPlayerMemo(selfPlayerId, `${cardName}: ${memo.text}`, { expiresAfterTurns: memo.expiresAfterTurns });
      }
    }
  }

  const remotePileModal = (
    <RemotePileModal
      onClose={() => setPileState(null)}
      onOpenCard={setRemoteDrawerCard}
      onMove={moveRemoteCard}
      onSelect={setRemoteSelection}
      pile={pileState}
      selection={remoteSelection}
    />
  );

  return (
    <div
      className="multiplayer-simulator"
      onMouseMove={(event) => {
        if (remoteBatchSelection) {
          updateRemoteBatchCursor(event);
        }
      }}
    >
      <section className="multiplayer-setup-panel">
        <label className="field">
          <span>방 코드</span>
          <input disabled={connectionState === "connected"} onChange={(event) => setRoomId(event.target.value.toUpperCase())} type="text" value={roomId} />
        </label>
        <label className="field">
          <span>플레이어 이름</span>
          <input disabled={connectionState === "connected"} onChange={(event) => setPlayerName(event.target.value)} type="text" value={playerName} />
        </label>
        <label className="field">
          <span>사용할 덱</span>
          {connectionState === "connected" ? (
            <input disabled type="text" value="선택 완료" />
          ) : (
            <select onChange={(event) => setSelectedDeckId(event.target.value)} value={selectedDeckId}>
              <option disabled value="">
                필드 준비 완료 덱 선택
              </option>
              {decks.map((deck) => (
                <option disabled={!deck.fieldReady} key={deck.id} value={deck.id}>
                  {deck.name} · {deck.authorLabel}
                  {deck.fieldReady ? "" : ` · 사용 불가 (${getDeckFieldRequirementLabel(deck)})`}
                </option>
              ))}
            </select>
          )}
        </label>
        <div className="multiplayer-setup-actions">
          <button className="button primary-button" disabled={!canConnect || connectionState === "loading"} onClick={() => connectToRoom()} type="button">
            {connectionState === "connected" ? "다시 연결" : connectionState === "loading" ? "연결 중" : "방 입장"}
          </button>
          <button className="button ghost-button" disabled={!recentSession || connectionState === "loading"} onClick={() => recentSession && connectToRoom({ recent: recentSession })} type="button">
            최근 세션
          </button>
          <button className="button ghost-button" disabled={connectionState !== "connected"} onClick={leaveRoom} type="button">
            나가기
          </button>
        </div>
        <div className="multiplayer-room-status" data-state={connectionState}>
          <strong>
            {connectionState === "connected" ? `${roomId.trim().toUpperCase()} ${myRole === "spectator" ? "관전 중" : "연결됨"}` : "대기"}
          </strong>
          <span>
            {connectionState === "connected"
              ? `${isGameReady ? "게임 준비 완료 · " : ""}${getTurnPhase(roomState.phaseIndex).label} · 턴 플레이어 ${roomState.turnPlayerName ?? "대기"} · 관전자 ${spectatorCount}명`
              : statusMessage || deckAvailabilityMessage || (recentSession ? `최근: ${recentSession.roomId}` : "방 코드를 상대에게 공유하세요.")}
          </span>
        </div>
      </section>

      {cards.length > 0 || myRole === "spectator" ? (
        <div className="multiplayer-play-layout" ref={playLayoutRef}>
          <aside
            className="multiplayer-opponent-panel"
            onContextMenuCapture={(event) => {
              if (!remoteBatchSelection) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              setRemoteSelection(null);
              setRemoteBatchCursor(null);
            }}
          >
            {remotePlayers.length > 0 ? (
              remotePlayers.map((player) => (
                <RemotePlayerBoard
                  canControl={canControlRemote}
                  canEndPhase={false}
                  isTurnPlayer={roomState.turnPlayerId === player.playerId}
                  key={player.playerId}
                  onBatchCursorMove={updateRemoteBatchCursor}
                  onAddMemo={addPlayerMemo}
                  onDeleteMemo={deletePlayerMemo}
                  onPhaseEnd={endPlayerPhase}
                  onMove={moveRemoteCard}
                  onOpenCard={setRemoteDrawerCard}
                  onOpenPile={(targetPlayer, source) => setPileState({ player: targetPlayer, source })}
                  onPeekDeck={peekRemoteDeck}
                  onPowerAdjust={adjustPlayerMainPower}
                  onSelect={setRemoteSelection}
                  player={player}
                  roomState={roomState}
                  selection={remoteSelection}
                  selfPlayerId={playerId}
                />
              ))
            ) : (
              <p className="multiplayer-help-text">아직 상대 플레이어가 없습니다.</p>
            )}
          </aside>

          {myRole === "player" && cards.length > 0 ? (
            <section className="multiplayer-board-panel" data-turn-player={roomState.turnPlayerId === playerId ? "true" : undefined}>
              <div className="section-heading">
                <div>
                  <div className="kicker">MY BOARD</div>
                  <h2>{selfPlayer?.playerName ?? playerName}</h2>
                </div>
              </div>
              {selfPlayer ? (
                <PlayerStatusPanel
                  canControl={canControlRemote}
                  canEndPhase={canEndPhase}
                  isTurnPlayer={roomState.turnPlayerId === selfPlayer.playerId}
                  onAddMemo={addPlayerMemo}
                  onDeleteMemo={deletePlayerMemo}
                  onPhaseEnd={endPlayerPhase}
                  player={selfPlayer}
                  roomState={roomState}
                  selfPlayerId={playerId}
                  showPhaseEndButton
                />
              ) : null}
              <SimulatorBoard
                cards={cards}
                effectCostModifier={selfPlayer?.effectCostModifier ?? 0}
                effectCostModifierScope={selfPlayer?.effectCostModifierScope ?? "all"}
                externalSnapshot={externalSnapshot}
                initialShuffleSeed={initialShuffleSeed}
                initialSnapshot={initialSnapshot}
                key={`${selectedDeckId}-${initialShuffleSeed}-${initialSnapshot?.updatedAt ?? "new"}`}
                fieldOverlay={remotePileModal}
                onActionLog={sendActionLog}
                onOncePerTurnEffectUsed={noteOncePerTurnEffectUse}
                onOpponentActions={handleOpponentActions}
                opponentMainPower={primaryRemoteMainPower}
                onSnapshotChange={handleSnapshotChange}
                onTurnLimitedEffectUsed={handleTurnLimitedEffectUse}
                opponentLifeControls={false}
                opponentLifeDefault={25}
                opponentLifeLabel="상대 덱"
                opponentLifeValue={opponentDeckCount}
              />
            </section>
          ) : (
            <section className="empty-panel">
              <strong>관전 상태로 입장했습니다.</strong>
              <p>플레이어 자리가 비어 있지 않아 보드 없이 방 상태를 확인합니다.</p>
            </section>
          )}
          <MultiplayerMemoPanel
            canControl={canControlRemote}
            onAddMemo={addPlayerMemo}
            onDeleteMemo={deletePlayerMemo}
            players={memoPlayers}
            selfPlayerId={playerId}
          />
        </div>
      ) : (
        <section className="empty-panel">
          <strong>방에 입장하면 보드가 열립니다.</strong>
          <p>같은 방 코드로 접속한 플레이어끼리 보드와 로그를 동기화합니다.</p>
        </section>
      )}

      <button
        aria-expanded={isLogDrawerOpen}
        className="multiplayer-log-toggle"
        onClick={() => setIsLogDrawerOpen((current) => !current)}
        type="button"
      >
        로그
        {roomLogs.length > 0 ? <span>{roomLogs.length}</span> : null}
      </button>
      <SessionLogPanel
        chatMessage={chatMessage}
        isOpen={isLogDrawerOpen}
        logs={roomLogs}
        onChatMessageChange={setChatMessage}
        onClose={() => setIsLogDrawerOpen(false)}
        onSubmitChat={submitChatMessage}
        selfPlayerId={playerId}
      />
      <PeekModal
        onClose={() => setPeekState(null)}
        onOpenCard={setRemoteDrawerCard}
        onMove={moveRemoteCard}
        onSelect={setRemoteSelection}
        peek={peekState}
        selection={remoteSelection}
      />
      <RemoteCardDrawer card={remoteDrawerCard} onClose={() => setRemoteDrawerCard(null)} />
      {myRole === "player" && cards.length > 0 ? null : remotePileModal}
      {remoteBatchSelection && remoteBatchCursor ? (
        <div className="simulator-batch-cursor multiplayer-remote-batch-cursor" style={{ left: remoteBatchCursor.x + 14, top: remoteBatchCursor.y + 14 }}>
          ×{remoteBatchSelection.count ?? 1}
        </div>
      ) : null}
    </div>
  );
}
