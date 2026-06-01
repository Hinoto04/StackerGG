import { MultiplayerSimulator, type MultiplayerDeckOption } from "./MultiplayerSimulator";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getDeckOptions(): Promise<MultiplayerDeckOption[]> {
  const decks = await prisma.deck.findMany({
    orderBy: [{ createdAt: "desc" }, { name: "asc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      author: {
        select: {
          displayName: true,
          loginId: true,
        },
      },
      items: {
        select: {
          isField: true,
          slotType: true,
        },
      },
    },
  });

  return decks.map((deck) => ({
    fieldMainCount: deck.items.filter((item) => item.isField && item.slotType === "MAIN").length,
    fieldReady: deck.items.some((item) => item.isField && item.slotType === "MAIN") && deck.items.filter((item) => item.isField && item.slotType === "SUB").length >= 3,
    fieldSubCount: deck.items.filter((item) => item.isField && item.slotType === "SUB").length,
    id: deck.id,
    name: deck.name,
    authorLabel: deck.author.displayName || deck.author.loginId,
  }));
}

export default async function MultiplayerSimulatorPage() {
  const [decks, user] = await Promise.all([getDeckOptions(), getCurrentUser()]);
  const initialPlayerName = user?.displayName || user?.loginId || "Player";

  return (
    <>
      <SiteHeader active="simulator" />

      <main className="site-shell content simulator-content">
        <section className="page-head">
          <div>
            <div className="kicker">MULTIPLAYER</div>
            <h1>멀티 시뮬레이터</h1>
            <p>방 코드를 공유해서 서로의 필드, 스택, 트래시 상태를 보며 플레이합니다.</p>
          </div>
        </section>

        <MultiplayerSimulator decks={decks} initialPlayerName={initialPlayerName} />
      </main>

      <footer className="site-shell site-footer simulator-footer">
        <span>StackerGG Multiplayer Simulator</span>
        <span>Room based WebSocket playtest</span>
      </footer>
    </>
  );
}
