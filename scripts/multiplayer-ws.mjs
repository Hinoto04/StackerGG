import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.MULTIPLAYER_WS_PORT || 3001);
const rooms = new Map();
const maxActivePlayers = 2;
const maxRoomLogs = 120;
const maxPlayerMemos = 20;

const turnPhases = [
  { id: "start", label: "스타트 페이즈" },
  { id: "draw", label: "드로우 페이즈" },
  { id: "main", label: "메인 페이즈" },
  { id: "battle", label: "배틀 페이즈" },
  { id: "end", label: "엔드 페이즈" },
];

const zoneIds = ["deck", "hand", "stack", "trash", "mainField", "subField1", "subField2", "subField3"];
const fieldZoneTypes = {
  mainField: "MAIN",
  subField1: "SUB",
  subField2: "SUB",
  subField3: "SUB",
};

const zoneLabels = {
  deck: "덱",
  hand: "손패",
  stack: "스택",
  trash: "트래시",
  mainField: "MAIN",
  subField1: "SUB 1",
  subField2: "SUB 2",
  subField3: "SUB 3",
};

function normalizeText(value, fallback = "", maxLength = 120) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeTurnDuration(value) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.min(5, Math.max(1, Math.floor(parsedValue)));
}

function getPlayerTurnCount(player) {
  return Number.isInteger(player?.turnCount) ? player.turnCount : 0;
}

function getOrderedActivePlayers(room) {
  return getActivePlayers(room).sort((firstPlayer, secondPlayer) => firstPlayer.joinedAt - secondPlayer.joinedAt);
}

function ensureRoomTurnState(room) {
  if (!Number.isInteger(room.phaseIndex)) {
    room.phaseIndex = 0;
  }

  if (!Number.isInteger(room.turnCount)) {
    room.turnCount = 1;
  }

  const activePlayers = getOrderedActivePlayers(room);

  if (activePlayers.length === 0) {
    room.turnPlayerId = null;
    return null;
  }

  if (!activePlayers.some((player) => player.playerId === room.turnPlayerId)) {
    room.turnPlayerId = activePlayers[0].playerId;
  }

  const turnPlayer = activePlayers.find((player) => player.playerId === room.turnPlayerId) ?? activePlayers[0];
  turnPlayer.turnCount = Math.max(1, getPlayerTurnCount(turnPlayer));

  return turnPlayer;
}

function getNextTurnPlayer(room, currentPlayerId) {
  const activePlayers = getOrderedActivePlayers(room);

  if (activePlayers.length === 0) {
    return null;
  }

  const currentIndex = Math.max(
    0,
    activePlayers.findIndex((player) => player.playerId === currentPlayerId),
  );

  return activePlayers[(currentIndex + 1) % activePlayers.length] ?? activePlayers[0];
}

function getTurnExpirationCount(targetPlayer, room, expiresAfterTurns) {
  const duration = normalizeTurnDuration(expiresAfterTurns);

  if (!duration) {
    return null;
  }

  const targetTurnCount = getPlayerTurnCount(targetPlayer);
  const isTargetTurnPlayer = room?.turnPlayerId === targetPlayer.playerId;

  return targetTurnCount + duration - (isTargetTurnPlayer ? 1 : 0);
}

function addPlayerMemo(targetPlayer, actor, text, options = {}) {
  const normalizedText = normalizeText(text, "", 240);

  if (!normalizedText) {
    return null;
  }

  const expiresAtTurnCount = getTurnExpirationCount(targetPlayer, options.room, options.expiresAfterTurns);
  const memo = {
    authorName: actor?.playerName ?? "System",
    authorPlayerId: actor?.playerId ?? "system",
    createdAt: Date.now(),
    id: randomUUID(),
    text: normalizedText,
  };

  if (expiresAtTurnCount !== null) {
    memo.expiresAtTurnCount = expiresAtTurnCount;
  }

  if (Number.isFinite(Number(options.triggerAtTurnStartCount))) {
    memo.triggerAtTurnStartCount = Number(options.triggerAtTurnStartCount);
  }

  if (options.scheduledEffect) {
    memo.scheduledEffect = options.scheduledEffect;
  }

  targetPlayer.memos = [memo, ...(Array.isArray(targetPlayer.memos) ? targetPlayer.memos : [])].slice(0, maxPlayerMemos);
  return memo;
}

function applyScheduledMemoEffect(player, memo) {
  if (memo.scheduledEffect?.type === "effectCostModifier") {
    const amount = Math.max(-9, Math.min(9, Number.isFinite(Number(memo.scheduledEffect.amount)) ? Math.floor(Number(memo.scheduledEffect.amount)) : 0));

    if (amount === 0) {
      return null;
    }

    player.effectCostModifier = Math.max(-9, Math.min(9, Number(player.effectCostModifier ?? 0) + amount));
    player.effectCostModifierExpiresAtTurnCount = getPlayerTurnCount(player);
    player.effectCostModifierScope = memo.scheduledEffect.scope === "main" ? "main" : "all";

    return {
      applied: true,
      message: `${player.playerName}: ${player.effectCostModifierScope === "main" ? "메인 효과" : "효과"} 코스트 ${amount > 0 ? `+${amount}` : amount}`,
    };
  }

  if (memo.scheduledEffect?.type !== "modifyMainPower") {
    return null;
  }

  const amount = Math.max(0, Math.floor(Number(memo.scheduledEffect.amount)));
  const mainCard = player.snapshot?.zones?.mainField?.[0] ?? null;

  if (!amount || !mainCard) {
    return {
      applied: false,
      message: `${player.playerName}: 예약된 메인 스태커 공격력 상승을 적용할 대상이 없습니다.`,
    };
  }

  player.snapshot = {
    ...player.snapshot,
    powerModifiers: {
      ...(player.snapshot.powerModifiers ?? {}),
      [mainCard.id]: Number(player.snapshot.powerModifiers?.[mainCard.id] ?? 0) + amount,
    },
    updatedAt: Date.now(),
  };
  player.snapshotOrigin = "system";

  return {
    applied: true,
    message: `${player.playerName}: 예약 효과로 ${mainCard.name} 공격력 +${amount}`,
  };
}

function applySnapshotPowerModifier(player, cardId, amount) {
  if (!player.snapshot?.zones || !cardId || !Number.isFinite(Number(amount))) {
    return false;
  }

  const currentModifier = Number(player.snapshot.powerModifiers?.[cardId] ?? 0);
  const nextModifier = currentModifier + Number(amount);
  const nextPowerModifiers = {
    ...(player.snapshot.powerModifiers ?? {}),
  };

  if (nextModifier === 0) {
    delete nextPowerModifiers[cardId];
  } else {
    nextPowerModifiers[cardId] = nextModifier;
  }

  player.snapshot = {
    ...player.snapshot,
    powerModifiers: nextPowerModifiers,
    updatedAt: Date.now(),
  };
  player.snapshotOrigin = "system";
  return true;
}

function addTemporaryMainPowerModifier(targetPlayer, amount, expiresAtTurnCount) {
  const mainCard = targetPlayer.snapshot?.zones?.mainField?.[0] ?? null;

  if (!mainCard || !applySnapshotPowerModifier(targetPlayer, mainCard.id, amount)) {
    return {
      applied: false,
      mainCard: null,
    };
  }

  targetPlayer.temporaryPowerModifiers = [
    ...(Array.isArray(targetPlayer.temporaryPowerModifiers) ? targetPlayer.temporaryPowerModifiers : []),
    {
      amount,
      cardId: mainCard.id,
      expiresAtTurnCount,
      id: randomUUID(),
    },
  ];

  return {
    applied: true,
    mainCard,
  };
}

function applyTurnStartMemoEffects(room, player) {
  const turnCount = getPlayerTurnCount(player);
  const remainingMemos = [];

  for (const memo of Array.isArray(player.memos) ? player.memos : []) {
    const triggerAtTurnStartCount = Number(memo.triggerAtTurnStartCount);

    if (!Number.isFinite(triggerAtTurnStartCount) || triggerAtTurnStartCount > turnCount) {
      remainingMemos.push(memo);
      continue;
    }

    const result = applyScheduledMemoEffect(player, memo);

    if (result?.message) {
      appendLog(room, null, result.message, { boardPlayerId: player.playerId });
    }
  }

  player.memos = remainingMemos;
}

function expireTemporaryPowerModifiers(room, player) {
  const turnCount = getPlayerTurnCount(player);
  const remainingModifiers = [];

  for (const modifier of Array.isArray(player.temporaryPowerModifiers) ? player.temporaryPowerModifiers : []) {
    const expiresAtTurnCount = Number(modifier.expiresAtTurnCount);
    const amount = Number(modifier.amount);
    const cardId = normalizeText(modifier.cardId, "", 80);

    if (!Number.isFinite(expiresAtTurnCount) || expiresAtTurnCount > turnCount) {
      remainingModifiers.push(modifier);
      continue;
    }

    const currentModifier = Number(player.snapshot?.powerModifiers?.[cardId] ?? 0);

    if (cardId && Number.isFinite(amount) && amount !== 0 && currentModifier !== 0 && applySnapshotPowerModifier(player, cardId, -amount)) {
      appendLog(room, null, `${player.playerName}: 메인 스태커 공격력 변경 효과가 종료되었습니다.`, {
        boardPlayerId: player.playerId,
      });
    }
  }

  player.temporaryPowerModifiers = remainingModifiers;
}

function expireTurnEffects(room, player) {
  const turnCount = getPlayerTurnCount(player);

  player.memos = (Array.isArray(player.memos) ? player.memos : []).filter(
    (memo) => !Number.isFinite(Number(memo.expiresAtTurnCount)) || Number(memo.expiresAtTurnCount) > turnCount,
  );

  if (Number.isFinite(Number(player.effectCostModifierExpiresAtTurnCount)) && Number(player.effectCostModifierExpiresAtTurnCount) <= turnCount) {
    player.effectCostModifier = 0;
    player.effectCostModifierExpiresAtTurnCount = null;
    player.effectCostModifierScope = "all";
  }

  expireTemporaryPowerModifiers(room, player);
}

function normalizeRoomId(value) {
  const normalized = normalizeText(value, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);

  return normalized || null;
}

function isZoneId(value) {
  return zoneIds.includes(value);
}

function isFieldZone(zoneId) {
  return Boolean(fieldZoneTypes[zoneId]);
}

function cloneZones(zones) {
  return zoneIds.reduce((nextZones, zoneId) => {
    nextZones[zoneId] = Array.isArray(zones?.[zoneId]) ? [...zones[zoneId]] : [];
    return nextZones;
  }, {});
}

function normalizeSnapshot(snapshot) {
  if (!snapshot?.zones) {
    return null;
  }

  return {
    cardVisualStates: typeof snapshot.cardVisualStates === "object" && snapshot.cardVisualStates ? snapshot.cardVisualStates : {},
    opponentLife: Number.isFinite(Number(snapshot.opponentLife)) ? Number(snapshot.opponentLife) : 25,
    powerModifiers: typeof snapshot.powerModifiers === "object" && snapshot.powerModifiers ? snapshot.powerModifiers : {},
    updatedAt: Date.now(),
    zones: cloneZones(snapshot.zones),
  };
}

function getRoom(roomId) {
  let room = rooms.get(roomId);

  if (!room) {
    room = {
      id: roomId,
      logs: [],
      phaseIndex: 0,
      players: new Map(),
      turnCount: 1,
      turnPlayerId: null,
    };
    rooms.set(roomId, room);
  }

  return room;
}

function appendLog(room, actor, message, options = {}) {
  const text = normalizeText(message, "");

  if (!text) {
    return;
  }

  const logEntry = {
    at: Date.now(),
    id: randomUUID(),
    boardPlayerId: options.boardPlayerId ?? actor?.playerId ?? "system",
    message: text,
    playerId: actor?.playerId ?? "system",
    playerName: actor?.playerName ?? "System",
  };

  for (const key of [
    "currentPhaseLabel",
    "kind",
    "memoText",
    "nextPhaseLabel",
    "nextTurnPlayerId",
    "nextTurnPlayerName",
    "phasePlayerId",
    "phasePlayerName",
    "targetPlayerId",
    "targetPlayerName",
  ]) {
    const value = options[key];

    if (typeof value === "string" && value.trim()) {
      logEntry[key] = normalizeText(value, "", key === "memoText" ? 240 : 80);
    }
  }

  if (options.hideActor) {
    logEntry.hideActor = true;
  }

  if (options.isNewTurn) {
    logEntry.isNewTurn = true;
  }

  if (Number.isFinite(Number(options.turnCount))) {
    logEntry.turnCount = Number(options.turnCount);
  }

  room.logs.push(logEntry);

  if (room.logs.length > maxRoomLogs) {
    room.logs.splice(0, room.logs.length - maxRoomLogs);
  }
}

function getActivePlayers(room) {
  return [...room.players.values()].filter((player) => player.role === "player");
}

function getVisibleCard(card, snapshot, forceFaceUp = false) {
  const visualState = snapshot?.cardVisualStates?.[card.id];

  if (visualState?.faceDown && !forceFaceUp) {
    return {
      faceDown: true,
      id: card.id,
    };
  }

  return {
    ...card,
    faceDown: false,
  };
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot?.zones) {
    return null;
  }

  const zones = cloneZones(snapshot.zones);
  const stackTopCard = zones.stack[0] ?? null;
  const trashTopCard = zones.trash.at(-1) ?? null;

  return {
    counts: {
      deck: zones.deck.length,
      hand: zones.hand.length,
      stack: zones.stack.length,
      trash: zones.trash.length,
    },
    opponentLife: snapshot.opponentLife,
    publicZones: {
      mainField: zones.mainField.map((card) => getVisibleCard(card, snapshot)),
      stack: zones.stack.map((card) => getVisibleCard(card, snapshot, true)),
      stackTop: stackTopCard ? getVisibleCard(stackTopCard, snapshot, true) : null,
      subField1: zones.subField1.map((card) => getVisibleCard(card, snapshot)),
      subField2: zones.subField2.map((card) => getVisibleCard(card, snapshot)),
      subField3: zones.subField3.map((card) => getVisibleCard(card, snapshot)),
      trash: zones.trash.map((card) => getVisibleCard(card, snapshot, true)),
      trashTop: trashTopCard ? getVisibleCard(trashTopCard, snapshot, true) : null,
    },
    updatedAt: snapshot.updatedAt ?? Date.now(),
  };
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function serializePlayerFor(player, recipient) {
  const isSelf = player.playerId === recipient.playerId;
  const isActivePlayer = player.role === "player";

  return {
    connected: Boolean(player.ws && player.ws.readyState === WebSocket.OPEN),
    deckId: player.deckId,
    deckName: player.deckName,
    effectCostModifier: Number.isFinite(Number(player.effectCostModifier)) ? Number(player.effectCostModifier) : 0,
    effectCostModifierExpiresAtTurnCount: Number.isFinite(Number(player.effectCostModifierExpiresAtTurnCount))
      ? Number(player.effectCostModifierExpiresAtTurnCount)
      : null,
    effectCostModifierScope: player.effectCostModifierScope === "main" ? "main" : "all",
    joinedAt: player.joinedAt,
    memos: Array.isArray(player.memos) ? player.memos : [],
    phaseIndex: Number.isInteger(player.phaseIndex) ? player.phaseIndex : 0,
    playerId: player.playerId,
    playerName: player.playerName,
    publicSnapshot: !isSelf && isActivePlayer ? sanitizeSnapshot(player.snapshot) : undefined,
    role: player.role,
    snapshot: isActivePlayer ? player.snapshot ?? null : undefined,
    snapshotOrigin: isActivePlayer ? player.snapshotOrigin ?? null : undefined,
    turnCount: getPlayerTurnCount(player),
  };
}

function serializeRoomState(room) {
  const turnPlayer = ensureRoomTurnState(room);

  return {
    phaseIndex: Number.isInteger(room.phaseIndex) ? room.phaseIndex : 0,
    turnCount: Number.isInteger(room.turnCount) ? room.turnCount : 1,
    turnPlayerId: turnPlayer?.playerId ?? null,
    turnPlayerName: turnPlayer?.playerName ?? null,
  };
}

function broadcastRoom(room) {
  for (const recipient of room.players.values()) {
    if (!recipient.ws || recipient.ws.readyState !== WebSocket.OPEN) {
      continue;
    }

    send(recipient.ws, {
      logs: room.logs.slice(-80),
      players: [...room.players.values()].map((player) => serializePlayerFor(player, recipient)),
      roomId: room.id,
      roomState: serializeRoomState(room),
      type: "room",
    });
  }
}

function removeEmptyRoom(roomId) {
  const room = rooms.get(roomId);

  if (room && [...room.players.values()].every((player) => !player.ws || player.ws.readyState !== WebSocket.OPEN)) {
    setTimeout(() => {
      const currentRoom = rooms.get(roomId);

      if (currentRoom && [...currentRoom.players.values()].every((player) => !player.ws || player.ws.readyState !== WebSocket.OPEN)) {
        rooms.delete(roomId);
      }
    }, 60 * 60 * 1000).unref?.();
  }
}

function findCardInZones(zones, cardId) {
  for (const zoneId of zoneIds) {
    const index = zones[zoneId].findIndex((card) => card.id === cardId);

    if (index >= 0) {
      return {
        card: zones[zoneId][index],
        index,
        zoneId,
      };
    }
  }

  return null;
}

function takeSourceCards(zones, message) {
  if (message.cardId) {
    const found = findCardInZones(zones, normalizeText(message.cardId, ""));

    if (!found) {
      return { error: "이동할 카드를 찾을 수 없습니다." };
    }

    zones[found.zoneId].splice(found.index, 1);
    return {
      cards: [found.card],
      sourceZone: found.zoneId,
    };
  }

  const sourceZone = isZoneId(message.sourceZone) ? message.sourceZone : null;
  const count = Math.max(1, Math.min(99, Number.isFinite(Number(message.count)) ? Number(message.count) : 1));

  if (!sourceZone) {
    return { error: "이동할 카드의 출발 영역이 필요합니다." };
  }

  const sourceCards = zones[sourceZone];
  const cards = sourceZone === "trash" ? sourceCards.splice(Math.max(sourceCards.length - count, 0)) : sourceCards.splice(0, count);

  if (cards.length === 0) {
    return { error: "이동할 카드가 없습니다." };
  }

  return {
    cards,
    sourceZone,
  };
}

function canMoveTo(card, sourceZone, targetZone) {
  const requiredType = fieldZoneTypes[targetZone];
  return !requiredType || card.cardType === requiredType;
}

function isHiddenMove(sourceZone, targetZone) {
  return sourceZone === "deck" && (targetZone === "deck" || targetZone === "hand");
}

function getMovedCardLabel(card, sourceZone, targetZone) {
  if (isHiddenMove(sourceZone, targetZone)) {
    return "덱 맨 위 카드";
  }

  return card.name ?? "카드";
}

function moveCardInSnapshot(snapshot, message) {
  if (!snapshot?.zones) {
    return { error: "대상 보드가 아직 준비되지 않았습니다." };
  }

  const targetZone = isZoneId(message.targetZone) ? message.targetZone : null;

  if (!targetZone) {
    return { error: "이동할 도착 영역이 올바르지 않습니다." };
  }

  const zones = cloneZones(snapshot.zones);
  const sourceResult = takeSourceCards(zones, message);

  if (sourceResult.error) {
    return sourceResult;
  }

  const { cards, sourceZone } = sourceResult;

  if (sourceZone === targetZone && !(targetZone === "deck" && message.deckPlacement === "bottom")) {
    zones[sourceZone] = sourceZone === "trash" ? [...zones[sourceZone], ...cards] : [...cards, ...zones[sourceZone]];
    return { error: "같은 영역으로는 이동하지 않습니다." };
  }

  const movingCards = isFieldZone(targetZone) ? cards.filter((card) => canMoveTo(card, sourceZone, targetZone)).slice(0, 1) : cards;

  if (movingCards.length === 0) {
    zones[sourceZone] = sourceZone === "trash" ? [...zones[sourceZone], ...cards] : [...cards, ...zones[sourceZone]];
    return { error: "해당 영역으로 이동할 수 없는 카드입니다." };
  }

  const movingIds = new Set(movingCards.map((card) => card.id));
  const rejectedCards = cards.filter((card) => !movingIds.has(card.id));

  if (rejectedCards.length > 0) {
    zones[sourceZone] = sourceZone === "trash" ? [...zones[sourceZone], ...rejectedCards] : [...rejectedCards, ...zones[sourceZone]];
  }

  const deckPlacement = message.deckPlacement === "top" ? "top" : "bottom";

  if (isFieldZone(targetZone)) {
    zones.hand = [...zones.hand, ...zones[targetZone]];
    zones[targetZone] = movingCards;
  } else if (targetZone === "deck" && deckPlacement === "top") {
    zones.deck = [...movingCards, ...zones.deck];
  } else {
    zones[targetZone] = [...zones[targetZone], ...movingCards];
  }

  return {
    movedCardLabel: movingCards.length === 1 ? getMovedCardLabel(movingCards[0], sourceZone, targetZone) : `${movingCards.length}장`,
    movedCount: movingCards.length,
    nextSnapshot: {
      ...snapshot,
      updatedAt: Date.now(),
      zones,
    },
    sourceZone,
    targetZone,
  };
}

function getPlayerOrError(room, playerId) {
  const player = room?.players.get(playerId);

  if (!room || !player) {
    return null;
  }

  return player;
}

const wss = new WebSocketServer({ port });

wss.on("connection", (ws) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  ws.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(String(rawMessage));
    } catch {
      send(ws, { message: "메시지 형식이 올바르지 않습니다.", type: "error" });
      return;
    }

    if (message.type === "join") {
      const roomId = normalizeRoomId(message.roomId);
      const playerId = normalizeText(message.playerId, "");

      if (!roomId || !playerId) {
        send(ws, { message: "방 코드와 플레이어 정보가 필요합니다.", type: "error" });
        return;
      }

      const room = getRoom(roomId);
      const previousPlayer = room.players.get(playerId);

      if (previousPlayer?.ws && previousPlayer.ws !== ws) {
        previousPlayer.ws.close(4000, "Reconnected from another client");
      }

      const role = previousPlayer?.role ?? (getActivePlayers(room).length < maxActivePlayers ? "player" : "spectator");
      const initialSnapshot = role === "player" ? normalizeSnapshot(message.snapshot) : null;
      const player = {
        deckId: normalizeText(message.deckId, "unknown"),
        deckName: normalizeText(message.deckName, role === "spectator" ? "Spectator" : "Deck"),
        effectCostModifier: Number.isFinite(Number(previousPlayer?.effectCostModifier)) ? Number(previousPlayer.effectCostModifier) : 0,
        effectCostModifierExpiresAtTurnCount: Number.isFinite(Number(previousPlayer?.effectCostModifierExpiresAtTurnCount))
          ? Number(previousPlayer.effectCostModifierExpiresAtTurnCount)
          : null,
        effectCostModifierScope: previousPlayer?.effectCostModifierScope === "main" ? "main" : "all",
        joinedAt: previousPlayer?.joinedAt ?? Date.now(),
        memos: Array.isArray(previousPlayer?.memos) ? previousPlayer.memos : [],
        phaseIndex: Number.isInteger(previousPlayer?.phaseIndex) ? previousPlayer.phaseIndex : 0,
        playerId,
        playerName: normalizeText(message.playerName, "Player"),
        role,
        snapshot: previousPlayer?.snapshot ?? initialSnapshot,
        snapshotOrigin: previousPlayer?.snapshotOrigin ?? (initialSnapshot ? playerId : null),
        turnCount: Number.isInteger(previousPlayer?.turnCount) ? previousPlayer.turnCount : 0,
        ws,
      };

      currentRoomId = roomId;
      currentPlayerId = playerId;
      room.players.set(playerId, player);

      if (role === "player" && !room.turnPlayerId) {
        room.turnPlayerId = playerId;
        player.turnCount = Math.max(1, getPlayerTurnCount(player));
      }

      if (previousPlayer) {
        appendLog(room, player, role === "spectator" ? "관전자로 다시 접속했습니다." : "세션에 다시 접속했습니다.");
      } else {
        appendLog(room, player, role === "spectator" ? "플레이어 자리가 가득 차 관전자로 입장했습니다." : "플레이어로 입장했습니다.");
      }

      broadcastRoom(room);
      return;
    }

    if (message.type === "state") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const player = getPlayerOrError(room, currentPlayerId);

      if (!room || !player) {
        send(ws, { message: "방 정보를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (player.role !== "player") {
        send(ws, { message: "관전자는 보드 상태를 보낼 수 없습니다.", type: "error" });
        return;
      }

      player.snapshot = {
        ...message.snapshot,
        updatedAt: Date.now(),
      };
      player.snapshotOrigin = currentPlayerId;
      broadcastRoom(room);
      return;
    }

    if (message.type === "remoteMove") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      const result = moveCardInSnapshot(targetPlayer.snapshot, message);

      if (result.error) {
        send(ws, { message: result.error, type: "error" });
        return;
      }

      targetPlayer.snapshot = result.nextSnapshot;
      targetPlayer.snapshotOrigin = currentPlayerId;
      const cardLabel = result.movedCount === 1 ? `${result.movedCardLabel} · ` : "";
      appendLog(
        room,
        actor,
        `${cardLabel}${zoneLabels[result.sourceZone]} --(${result.movedCount})-> ${zoneLabels[result.targetZone]}`,
        { boardPlayerId: targetPlayer.playerId },
      );
      broadcastRoom(room);
      return;
    }

    if (message.type === "remotePeek") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      const cards = targetPlayer.snapshot?.zones?.deck?.slice(0, 3) ?? [];

      appendLog(room, actor, `${targetPlayer.playerName}의 덱 위 ${cards.length}장을 확인했습니다.`, { boardPlayerId: targetPlayer.playerId });
      send(ws, {
        cards,
        targetPlayerId: targetPlayer.playerId,
        targetPlayerName: targetPlayer.playerName,
        type: "peek",
      });
      broadcastRoom(room);
      return;
    }

    if (message.type === "phaseEnd") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const turnPlayer = room ? ensureRoomTurnState(room) : null;

      if (!room || !actor || !turnPlayer || turnPlayer.role !== "player") {
        send(ws, { message: "현재 턴 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (actor.playerId !== turnPlayer.playerId) {
        send(ws, { message: "현재 턴 플레이어만 페이즈를 종료할 수 있습니다.", type: "error" });
        return;
      }

      const currentPhaseIndex = Number.isInteger(room.phaseIndex) ? room.phaseIndex : 0;
      const nextPhaseIndex = (currentPhaseIndex + 1) % turnPhases.length;
      const currentPhase = turnPhases[currentPhaseIndex] ?? turnPhases[0];
      const nextPhase = turnPhases[nextPhaseIndex] ?? turnPhases[0];
      let nextTurnPlayer = turnPlayer;

      room.phaseIndex = nextPhaseIndex;

      if (nextPhaseIndex === 0) {
        expireTurnEffects(room, turnPlayer);
        nextTurnPlayer = getNextTurnPlayer(room, turnPlayer.playerId) ?? turnPlayer;
        nextTurnPlayer.turnCount = getPlayerTurnCount(nextTurnPlayer) + 1;
        room.turnPlayerId = nextTurnPlayer.playerId;
        room.turnCount = (Number.isInteger(room.turnCount) ? room.turnCount : 1) + 1;
        applyTurnStartMemoEffects(room, nextTurnPlayer);
      }

      const turnLabel = nextPhaseIndex === 0 ? `${nextTurnPlayer.playerName} ${room.turnCount}턴 ` : "";
      appendLog(room, actor, `${turnPlayer.playerName}: ${currentPhase.label} 종료 -> ${turnLabel}${nextPhase.label}`, {
        boardPlayerId: turnPlayer.playerId,
        currentPhaseLabel: currentPhase.label,
        hideActor: true,
        isNewTurn: nextPhaseIndex === 0,
        kind: "phaseEnd",
        nextPhaseLabel: nextPhase.label,
        nextTurnPlayerId: nextTurnPlayer.playerId,
        nextTurnPlayerName: nextTurnPlayer.playerName,
        phasePlayerId: turnPlayer.playerId,
        phasePlayerName: turnPlayer.playerName,
        turnCount: room.turnCount,
      });
      broadcastRoom(room);
      return;
    }

    if (message.type === "effectCostModifierAdd") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));
      const amount = Math.max(-5, Math.min(5, Number.isFinite(Number(message.amount)) ? Math.floor(Number(message.amount)) : 0));
      const scope = message.scope === "main" ? "main" : "all";

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (amount === 0) {
        send(ws, { message: "변경할 코스트 수치가 필요합니다.", type: "error" });
        return;
      }

      const expiresAfterTurns = normalizeTurnDuration(message.expiresAfterTurns) ?? 1;
      const expiresAtTurnCount = getTurnExpirationCount(targetPlayer, room, expiresAfterTurns) ?? getPlayerTurnCount(targetPlayer);
      targetPlayer.effectCostModifier = Math.max(-9, Math.min(9, Number(targetPlayer.effectCostModifier ?? 0) + amount));
      targetPlayer.effectCostModifierExpiresAtTurnCount = expiresAtTurnCount;
      targetPlayer.effectCostModifierScope = scope;

      const memoText = normalizeText(message.memoText, "", 240);

      if (memoText) {
        addPlayerMemo(targetPlayer, actor, memoText, {
          expiresAfterTurns,
          room,
        });
      }

      const fallbackMemoText = `이번 턴 ${scope === "main" ? "메인 효과" : "효과"} 코스트 ${amount > 0 ? `+${amount}` : amount}`;

      appendLog(room, actor, `${targetPlayer.playerName}에게 메모 추가: ${memoText || fallbackMemoText}`, {
        boardPlayerId: targetPlayer.playerId,
        hideActor: true,
        kind: "memoAdd",
        memoText: memoText || fallbackMemoText,
        targetPlayerId: targetPlayer.playerId,
        targetPlayerName: targetPlayer.playerName,
      });
      broadcastRoom(room);
      return;
    }

    if (message.type === "scheduleMainPowerBoost") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));
      const amount = Math.max(0, Math.min(9999, Number.isFinite(Number(message.amount)) ? Math.floor(Number(message.amount)) : 0));

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (amount <= 0) {
        send(ws, { message: "예약할 공격력 상승 수치가 필요합니다.", type: "error" });
        return;
      }

      const text = normalizeText(message.text, `다음 자신의 턴 시작 시 메인 스태커 공격력 +${amount}`, 240);

      addPlayerMemo(targetPlayer, actor, text, {
        scheduledEffect: {
          amount,
          type: "modifyMainPower",
        },
        triggerAtTurnStartCount: getPlayerTurnCount(targetPlayer) + 1,
      });
      appendLog(room, actor, `${targetPlayer.playerName}에게 메모 추가: ${text}`, {
        boardPlayerId: targetPlayer.playerId,
        hideActor: true,
        kind: "memoAdd",
        memoText: text,
        targetPlayerId: targetPlayer.playerId,
        targetPlayerName: targetPlayer.playerName,
      });
      broadcastRoom(room);
      return;
    }

    if (message.type === "mainPowerModifierAdd") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));
      const amount = Math.max(-9999, Math.min(9999, Number.isFinite(Number(message.amount)) ? Math.floor(Number(message.amount)) : 0));

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (amount === 0) {
        send(ws, { message: "변경할 공격력 수치가 필요합니다.", type: "error" });
        return;
      }

      const expiresAfterTurns = normalizeTurnDuration(message.expiresAfterTurns) ?? 1;
      const expiresAtTurnCount = getTurnExpirationCount(targetPlayer, room, expiresAfterTurns) ?? getPlayerTurnCount(targetPlayer);
      const result = addTemporaryMainPowerModifier(targetPlayer, amount, expiresAtTurnCount);
      const memoText = normalizeText(
        message.memoText,
        `다음 턴 종료 시까지 메인 스태커 공격력 ${amount > 0 ? `+${amount}` : amount}`,
        240,
      );

      addPlayerMemo(targetPlayer, actor, memoText, {
        expiresAfterTurns,
        room,
      });

      appendLog(room, actor, `${targetPlayer.playerName}에게 메모 추가: ${memoText}`, {
        boardPlayerId: targetPlayer.playerId,
        hideActor: true,
        kind: "memoAdd",
        memoText,
        targetPlayerId: targetPlayer.playerId,
        targetPlayerName: targetPlayer.playerName,
      });

      if (result.applied) {
        appendLog(room, actor, `${targetPlayer.playerName}: ${result.mainCard.name} 공격력 ${amount > 0 ? `+${amount}` : amount}`, {
          boardPlayerId: targetPlayer.playerId,
        });
      } else {
        appendLog(room, actor, `${targetPlayer.playerName}: 공격력을 변경할 메인 스태커가 없습니다.`, {
          boardPlayerId: targetPlayer.playerId,
        });
      }

      broadcastRoom(room);
      return;
    }

    if (message.type === "scheduleEffectCostModifier") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));
      const amount = Math.max(-9, Math.min(9, Number.isFinite(Number(message.amount)) ? Math.floor(Number(message.amount)) : 0));
      const scope = message.scope === "main" ? "main" : "all";

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (amount === 0) {
        send(ws, { message: "예약할 코스트 수치가 필요합니다.", type: "error" });
        return;
      }

      const text = normalizeText(message.text, `다음 턴 ${scope === "main" ? "메인 효과" : "효과"} 코스트 ${amount > 0 ? `+${amount}` : amount}`, 240);

      addPlayerMemo(targetPlayer, actor, text, {
        scheduledEffect: {
          amount,
          scope,
          type: "effectCostModifier",
        },
        triggerAtTurnStartCount: getPlayerTurnCount(targetPlayer) + 1,
      });
      appendLog(room, actor, `${targetPlayer.playerName}에게 메모 추가: ${text}`, {
        boardPlayerId: targetPlayer.playerId,
        hideActor: true,
        kind: "memoAdd",
        memoText: text,
        targetPlayerId: targetPlayer.playerId,
        targetPlayerName: targetPlayer.playerName,
      });
      broadcastRoom(room);
      return;
    }

    if (message.type === "mainPowerModifierAdjust") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));
      const amount = Math.max(-9999, Math.min(9999, Number.isFinite(Number(message.amount)) ? Math.floor(Number(message.amount)) : 0));

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (amount === 0) {
        send(ws, { message: "변경할 파워 수치가 필요합니다.", type: "error" });
        return;
      }

      const mainCard = targetPlayer.snapshot?.zones?.mainField?.[0] ?? null;

      if (!mainCard || !applySnapshotPowerModifier(targetPlayer, mainCard.id, amount)) {
        send(ws, { message: "파워를 조정할 메인 스태커가 없습니다.", type: "error" });
        return;
      }

      appendLog(room, actor, `${mainCard.name} 파워 ${amount > 0 ? `+${amount}` : amount}`, {
        boardPlayerId: targetPlayer.playerId,
      });
      broadcastRoom(room);
      return;
    }

    if (message.type === "memoAdd") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));
      const text = normalizeText(message.text, "", 240);

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      if (!text) {
        send(ws, { message: "메모 내용을 입력해야 합니다.", type: "error" });
        return;
      }

      addPlayerMemo(targetPlayer, actor, text, {
        expiresAfterTurns: message.expiresAfterTurns,
        room,
      });
      appendLog(room, actor, `${targetPlayer.playerName}에게 메모 추가: ${text}`, {
        boardPlayerId: targetPlayer.playerId,
        hideActor: true,
        kind: "memoAdd",
        memoText: text,
        targetPlayerId: targetPlayer.playerId,
        targetPlayerName: targetPlayer.playerName,
      });
      broadcastRoom(room);
      return;
    }

    if (message.type === "memoDelete") {
      if (!currentRoomId || !currentPlayerId) {
        send(ws, { message: "방에 먼저 입장해야 합니다.", type: "error" });
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);
      const targetPlayer = getPlayerOrError(room, normalizeText(message.targetPlayerId, ""));
      const memoId = normalizeText(message.memoId, "");

      if (!room || !actor || !targetPlayer || targetPlayer.role !== "player") {
        send(ws, { message: "대상 플레이어를 찾을 수 없습니다.", type: "error" });
        return;
      }

      const previousMemos = Array.isArray(targetPlayer.memos) ? targetPlayer.memos : [];
      targetPlayer.memos = previousMemos.filter((memo) => memo.id !== memoId);

      if (targetPlayer.memos.length !== previousMemos.length) {
        appendLog(room, actor, `${targetPlayer.playerName}의 메모를 삭제했습니다.`, {
          boardPlayerId: targetPlayer.playerId,
          hideActor: true,
          kind: "memoDelete",
          targetPlayerId: targetPlayer.playerId,
          targetPlayerName: targetPlayer.playerName,
        });
      }

      broadcastRoom(room);
      return;
    }

    if (message.type === "log") {
      if (!currentRoomId || !currentPlayerId) {
        return;
      }

      const room = rooms.get(currentRoomId);
      const actor = getPlayerOrError(room, currentPlayerId);

      if (!room || !actor) {
        return;
      }

      appendLog(room, actor, normalizeText(message.message, ""));
      broadcastRoom(room);
      return;
    }

    if (message.type === "ping") {
      send(ws, { at: Date.now(), type: "pong" });
    }
  });

  ws.on("close", () => {
    if (!currentRoomId || !currentPlayerId) {
      return;
    }

    const room = rooms.get(currentRoomId);
    const player = room?.players.get(currentPlayerId);

    if (!room || !player || player.ws !== ws) {
      return;
    }

    player.ws = null;
    appendLog(room, player, "연결이 끊겼습니다.");
    broadcastRoom(room);
    removeEmptyRoom(currentRoomId);
  });
});

console.log(`StackerGG multiplayer WebSocket server listening on ws://localhost:${port}`);
