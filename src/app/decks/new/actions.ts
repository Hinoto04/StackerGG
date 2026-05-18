"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CARD_TYPES, type CardType } from "@/data/cards";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type DeckFormField = "name" | "description" | "items";

export interface DeckFormState {
  status: "idle" | "error";
  message: string;
  fieldErrors: Partial<Record<DeckFormField, string>>;
}

type DeckPayloadItem = {
  cardId: string;
  slotType: CardType;
  quantity: number;
};

const DECK_LIMITS: Record<CardType, number> = {
  MAIN: 3,
  SUB: 9,
  ACTIVE: 21,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getText(formData: FormData, key: DeckFormField) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isCardType(value: string): value is CardType {
  return CARD_TYPES.includes(value as CardType);
}

function parseDeckItems(rawItems: string): DeckPayloadItem[] | null {
  try {
    const parsed = JSON.parse(rawItems);

    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.map((item) => ({
      cardId: typeof item?.cardId === "string" ? item.cardId : "",
      slotType: typeof item?.slotType === "string" && isCardType(item.slotType) ? item.slotType : ("" as CardType),
      quantity: Number(item?.quantity),
    }));
  } catch {
    return null;
  }
}

function createError(message: string, fieldErrors: DeckFormState["fieldErrors"] = {}): DeckFormState {
  return {
    status: "error",
    message,
    fieldErrors,
  };
}

export async function createDeckAction(_previousState: DeckFormState, formData: FormData): Promise<DeckFormState> {
  const user = await getCurrentUser();
  const name = getText(formData, "name");
  const description = getText(formData, "description");
  const parsedItems = parseDeckItems(getText(formData, "items"));

  const fieldErrors: DeckFormState["fieldErrors"] = {};

  if (!user) {
    return createError("덱을 저장하려면 로그인해야 합니다.");
  }

  if (!name) {
    fieldErrors.name = "덱 이름을 입력해주세요.";
  }

  if (!parsedItems) {
    fieldErrors.items = "덱 구성을 읽을 수 없습니다.";
  }

  if (Object.keys(fieldErrors).length > 0 || !parsedItems) {
    return createError("입력값을 확인해주세요.", fieldErrors);
  }

  const seenCardIds = new Set<string>();
  for (const item of parsedItems) {
    if (!UUID_PATTERN.test(item.cardId)) {
      fieldErrors.items = "잘못된 카드가 포함되어 있습니다.";
      break;
    }

    if (!isCardType(item.slotType)) {
      fieldErrors.items = "잘못된 카드 타입이 포함되어 있습니다.";
      break;
    }

    if (seenCardIds.has(item.cardId)) {
      fieldErrors.items = "같은 카드가 중복 항목으로 포함되어 있습니다.";
      break;
    }

    seenCardIds.add(item.cardId);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return createError("덱 구성을 확인해주세요.", fieldErrors);
  }

  const cards = await prisma.card.findMany({
    where: {
      id: {
        in: parsedItems.map((item) => item.cardId),
      },
    },
    select: {
      id: true,
      cardType: true,
    },
  });
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const counts: Record<CardType, number> = {
    MAIN: 0,
    SUB: 0,
    ACTIVE: 0,
  };

  for (const item of parsedItems) {
    const card = cardsById.get(item.cardId);

    if (!card) {
      fieldErrors.items = "존재하지 않는 카드가 포함되어 있습니다.";
      break;
    }

    if (card.cardType !== item.slotType) {
      fieldErrors.items = "카드 타입과 덱 슬롯 타입이 일치하지 않습니다.";
      break;
    }

    if (item.slotType === "ACTIVE") {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 3) {
        fieldErrors.items = "액티브 카드는 같은 카드 최대 3장까지 넣을 수 있습니다.";
        break;
      }
    } else if (item.quantity !== 1) {
      fieldErrors.items = "메인과 서브 카드는 중복될 수 없습니다.";
      break;
    }

    counts[item.slotType] += item.quantity;
  }

  for (const type of CARD_TYPES) {
    if (counts[type] !== DECK_LIMITS[type]) {
      fieldErrors.items = `덱은 MAIN ${DECK_LIMITS.MAIN}장, SUB ${DECK_LIMITS.SUB}장, ACTIVE ${DECK_LIMITS.ACTIVE}장으로 구성해야 합니다.`;
      break;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return createError("덱 구성을 확인해주세요.", fieldErrors);
  }

  let createdDeckId = "";

  try {
    const deck = await prisma.deck.create({
      data: {
        name,
        authorId: user.id,
        description: description || null,
        items: {
          create: parsedItems.map((item, index) => ({
            cardId: item.cardId,
            slotType: item.slotType,
            quantity: item.quantity,
            displayOrder: index,
          })),
        },
      },
      select: {
        id: true,
      },
    });

    createdDeckId = deck.id;
  } catch (error) {
    console.error("Failed to create deck", error);
    return createError("덱을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  revalidatePath("/decks/new");
  revalidatePath("/decks");
  revalidatePath(`/decks/${createdDeckId}`);
  redirect(`/decks/${createdDeckId}`);
}
