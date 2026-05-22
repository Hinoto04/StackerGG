"use server";

import { revalidatePath } from "next/cache";
import { getAllowedRaritiesForCardType, isCardType, normalizeCardType } from "@/data/cards";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type CardFormField =
  | "name"
  | "collectionNumber"
  | "tags"
  | "cardType"
  | "power"
  | "activeCost"
  | "activeEffect"
  | "mainCost"
  | "mainEffect"
  | "subCost"
  | "subEffect"
  | "packId"
  | "rarities";

export interface CardFormState {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors: Partial<Record<CardFormField, string>>;
  createdCard?: {
    name: string;
    collectionNumber: string;
  };
}

function getText(formData: FormData, key: CardFormField) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRarity(value: string) {
  return value.trim().toUpperCase();
}

function getRarities(formData: FormData) {
  const selectedRarities = formData.getAll("rarities").filter((value): value is string => typeof value === "string");

  return Array.from(new Set(selectedRarities.map(normalizeRarity).filter(Boolean)));
}

export async function createCardAction(_previousState: CardFormState, formData: FormData): Promise<CardFormState> {
  const user = await getCurrentUser();
  const name = getText(formData, "name");
  const cardType = normalizeCardType(getText(formData, "cardType"));
  const collectionNumber = getText(formData, "collectionNumber").toUpperCase();
  const tags = getText(formData, "tags");
  const powerRaw = getText(formData, "power");
  const activeCost = getText(formData, "activeCost");
  const activeEffect = getText(formData, "activeEffect");
  const mainCost = getText(formData, "mainCost");
  const mainEffect = getText(formData, "mainEffect");
  const subCost = getText(formData, "subCost");
  const subEffect = getText(formData, "subEffect");
  const packId = getText(formData, "packId");
  const rarities = getRarities(formData);
  const fieldErrors: CardFormState["fieldErrors"] = {};

  if (user?.role !== "ADMIN") {
    return {
      status: "error",
      message: "카드 데이터를 추가하려면 관리자 권한이 필요합니다.",
      fieldErrors: {},
    };
  }

  if (!name) {
    fieldErrors.name = "카드명을 입력해주세요.";
  }

  if (!collectionNumber) {
    fieldErrors.collectionNumber = "수록 번호를 입력해주세요.";
  }

  if (!cardType || !isCardType(cardType)) {
    fieldErrors.cardType = "카드 타입은 MAIN, SUB, ACTIVE 중에서 선택해주세요.";
  }

  if (!activeCost) {
    fieldErrors.activeCost = "액티브 코스트를 입력해주세요.";
  }

  if (!activeEffect) {
    fieldErrors.activeEffect = "액티브 효과를 입력해주세요.";
  }

  if (cardType === "MAIN") {
    if (!mainCost) {
      fieldErrors.mainCost = "메인 코스트를 입력해주세요.";
    }

    if (!mainEffect) {
      fieldErrors.mainEffect = "메인 효과를 입력해주세요.";
    }
  }

  if (cardType === "SUB") {
    if (!subCost) {
      fieldErrors.subCost = "서브 코스트를 입력해주세요.";
    }

    if (!subEffect) {
      fieldErrors.subEffect = "서브 효과를 입력해주세요.";
    }
  }

  if (!packId) {
    fieldErrors.packId = "수록 팩을 선택해주세요.";
  }

  if (rarities.length === 0) {
    fieldErrors.rarities = "수록 레어도를 하나 이상 선택해주세요.";
  }

  const allowedRarities = getAllowedRaritiesForCardType(cardType);
  const invalidRarities = rarities.filter((rarity) => !allowedRarities.includes(rarity));

  if (invalidRarities.length > 0) {
    fieldErrors.rarities = `${cardType} 타입에 사용할 수 없는 레어도입니다: ${invalidRarities.join(", ")}`;
  }

  let power: number | null = null;
  if (powerRaw) {
    const parsedPower = Number(powerRaw);

    if (!Number.isInteger(parsedPower) || parsedPower < 0) {
      fieldErrors.power = "파워는 0 이상의 정수로 입력해주세요.";
    } else {
      power = parsedPower;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "입력값을 확인해주세요.",
      fieldErrors,
    };
  }

  const existingCard = await prisma.card.findUnique({
    where: { collectionNumber },
    select: { id: true },
  });

  if (existingCard) {
    return {
      status: "error",
      message: "이미 등록된 수록 번호입니다.",
      fieldErrors: {
        collectionNumber: "다른 수록 번호를 입력해주세요.",
      },
    };
  }

  const pack = await prisma.pack.findUnique({
    where: { id: packId },
    select: { id: true },
  });

  if (!pack) {
    return {
      status: "error",
      message: "선택한 팩을 찾을 수 없습니다.",
      fieldErrors: {
        packId: "DB에 등록된 팩인지 확인해주세요.",
      },
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const card = await tx.card.create({
        data: {
          name,
          cardType,
          power,
          activeCost,
          activeEffect,
          mainCost: cardType === "MAIN" ? mainCost : null,
          mainEffect: cardType === "MAIN" ? mainEffect : null,
          subCost: cardType === "SUB" ? subCost : null,
          subEffect: cardType === "SUB" ? subEffect : null,
          collectionNumber,
          tags,
        },
        select: {
          id: true,
        },
      });

      await tx.cardRelease.createMany({
        data: rarities.map((rarity) => ({
          cardName: name,
          cardId: card.id,
          rarity,
          packId,
          collectionNumber,
        })),
      });
    });

    revalidatePath("/");
    revalidatePath("/cards/new");

    return {
      status: "success",
      message: `${name} 카드와 수록 정보 ${rarities.length}건이 등록되었습니다.`,
      fieldErrors: {},
      createdCard: {
        name,
        collectionNumber,
      },
    };
  } catch (error) {
    console.error("Failed to create card", error);

    return {
      status: "error",
      message: "카드를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
      fieldErrors: {},
    };
  }
}
