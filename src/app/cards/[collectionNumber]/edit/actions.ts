"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCardType, normalizeCardType } from "@/data/cards";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function updateCardAction(formData: FormData) {
  await requireAdmin();

  const id = getText(formData, "id");
  const name = getText(formData, "name");
  const collectionNumber = getText(formData, "collectionNumber").toUpperCase();
  const tags = getText(formData, "tags");
  const cardType = normalizeCardType(getText(formData, "cardType"));
  const powerRaw = getText(formData, "power");
  const activeCost = getText(formData, "activeCost");
  const activeEffect = getText(formData, "activeEffect");
  const mainCost = getText(formData, "mainCost");
  const mainEffect = getText(formData, "mainEffect");
  const subCost = getText(formData, "subCost");
  const subEffect = getText(formData, "subEffect");

  if (!id || !name || !collectionNumber || !isCardType(cardType) || !activeCost || !activeEffect) {
    redirect(`/cards/${encodeURIComponent(collectionNumber || id)}/edit?error=invalid`);
  }

  let power: number | null = null;
  if (powerRaw) {
    const parsedPower = Number(powerRaw);

    if (!Number.isInteger(parsedPower) || parsedPower < 0) {
      redirect(`/cards/${encodeURIComponent(collectionNumber)}/edit?error=power`);
    }

    power = parsedPower;
  }

  if (cardType === "MAIN" && (!mainCost || !mainEffect)) {
    redirect(`/cards/${encodeURIComponent(collectionNumber)}/edit?error=main`);
  }

  if (cardType === "SUB" && (!subCost || !subEffect)) {
    redirect(`/cards/${encodeURIComponent(collectionNumber)}/edit?error=sub`);
  }

  await prisma.card.update({
    where: { id },
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
  });

  revalidatePath("/");
  revalidatePath(`/cards/${collectionNumber}`);
  revalidatePath(`/cards/${collectionNumber}/edit`);
  redirect(`/cards/${encodeURIComponent(collectionNumber)}`);
}
