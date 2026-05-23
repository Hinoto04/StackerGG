import { SiteHeader } from "@/components/SiteHeader";
import { getRepresentativeCardImageUrl, isCardType, type CardType } from "@/data/cards";
import { prisma } from "@/lib/prisma";
import { StackerSimulator, type SimulatorDeck } from "./StackerSimulator";

export const dynamic = "force-dynamic";

async function getSimulatorDecks(): Promise<SimulatorDeck[]> {
  const decks = await prisma.deck.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
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
        orderBy: [{ slotType: "asc" }, { displayOrder: "asc" }],
        select: {
          id: true,
          slotType: true,
          quantity: true,
          displayOrder: true,
          isField: true,
          card: {
            select: {
              id: true,
              name: true,
              cardType: true,
              power: true,
              activeCost: true,
              activeEffect: true,
              mainCost: true,
              mainEffect: true,
              subCost: true,
              subEffect: true,
              collectionNumber: true,
              tags: true,
              releases: {
                select: {
                  collectionNumber: true,
                  rarity: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return decks.map((deck) => ({
    id: deck.id,
    name: deck.name,
    authorName: deck.author.displayName || deck.author.loginId,
    items: deck.items.flatMap((item) => {
      if (!isCardType(item.slotType) || !isCardType(item.card.cardType)) {
        return [];
      }

      return [
        {
          id: item.id,
          slotType: item.slotType as CardType,
          quantity: item.quantity,
          displayOrder: item.displayOrder,
          isField: item.isField,
          card: {
            id: item.card.id,
            name: item.card.name,
            cardType: item.card.cardType as CardType,
            power: item.card.power,
            activeCost: item.card.activeCost,
            activeEffect: item.card.activeEffect,
            mainCost: item.card.mainCost,
            mainEffect: item.card.mainEffect,
            subCost: item.card.subCost,
            subEffect: item.card.subEffect,
            collectionNumber: item.card.collectionNumber,
            tags: item.card.tags,
            imageUrl: getRepresentativeCardImageUrl(item.card, "list"),
          },
        },
      ];
    }),
  }));
}

export default async function SimulatorPage() {
  const decks = await getSimulatorDecks();

  return (
    <>
      <SiteHeader active="simulator" />

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">PLAY SIMULATOR</div>
            <h1>스태커배틀 시뮬레이터</h1>
            <p>
              공식 플레이 흐름을 기준으로 덱 준비, 페이즈 진행, 스택 비용 지불, 공격 대미지, 효과 로그를 수동으로
              관리합니다.
            </p>
          </div>
          <div className="head-chips">
            <span>저장 덱 {decks.length}개</span>
            <span>MAIN 3 / SUB 9 / ACTIVE 21</span>
          </div>
        </section>

        <StackerSimulator decks={decks} />
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Simulator</span>
        <span>Manual effect assistant</span>
      </footer>
    </>
  );
}
