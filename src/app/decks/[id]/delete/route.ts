import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageDeck, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteParams = {
  id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<RouteParams> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  if (!UUID_PATTERN.test(id)) {
    redirect("/decks");
  }

  const deck = await prisma.deck.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
    },
  });

  if (!deck || !canManageDeck(user, deck)) {
    redirect(`/decks/${id}`);
  }

  await prisma.deck.delete({
    where: { id },
  });

  revalidatePath("/decks");
  redirect("/decks");
}
