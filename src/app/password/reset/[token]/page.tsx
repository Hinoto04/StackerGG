import { ResetConfirmForm } from "./ResetConfirmForm";
import { SiteHeader } from "@/components/SiteHeader";

type RouteParams = {
  token: string;
};

export const dynamic = "force-dynamic";

export default async function PasswordResetConfirmPage({ params }: { params: Promise<RouteParams> }) {
  const { token } = await params;

  return (
    <>
      <SiteHeader active="login" />
      <main className="site-shell content auth-page">
        <section className="page-head">
          <div>
            <div className="kicker">ACCOUNT</div>
            <h1>새 비밀번호 설정</h1>
            <p>비밀번호는 해시 처리되어 저장됩니다.</p>
          </div>
        </section>
        <ResetConfirmForm token={decodeURIComponent(token)} />
      </main>
    </>
  );
}
