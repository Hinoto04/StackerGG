import { CardCreateForm } from "./CardCreateForm";
import { SiteHeader } from "@/components/SiteHeader";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getPackOptions() {
  const packs = await prisma.pack.findMany({
    orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      codePrefix: true,
      releaseDate: true,
    },
  });

  return packs.map((pack) => ({
    ...pack,
    releaseDate: pack.releaseDate.toISOString().slice(0, 10),
  }));
}

export default async function NewCardPage() {
  await requireAdmin();
  const packs = await getPackOptions();

  return (
    <>
      <SiteHeader active="card-new" />

      <main className="site-shell content">
        <section className="page-head">
          <div>
            <div className="kicker">CARD DATABASE</div>
            <h1>카드 추가</h1>
            <p>카드 기본 정보와 함께 같은 수록 번호로 들어가는 팩/레어도 수록 정보를 생성합니다.</p>
          </div>
          <div className="head-chips">
            <span>등록된 팩 {packs.length}개</span>
            <a className="button ghost-button" href="/">
              목록 보기
            </a>
          </div>
        </section>

        <CardCreateForm packs={packs} />
      </main>

      <footer className="site-shell site-footer">
        <span>StackerGG Card Database</span>
        <span>New cards are written directly to the database.</span>
      </footer>
    </>
  );
}
