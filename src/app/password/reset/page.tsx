import { ResetRequestForm } from "./ResetRequestForm";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

export default function PasswordResetPage() {
  return (
    <>
      <SiteHeader active="login" />
      <main className="site-shell content auth-page">
        <section className="page-head">
          <div>
            <div className="kicker">ACCOUNT</div>
            <h1>비밀번호 재설정</h1>
            <p>가입한 이메일로 비밀번호 재설정 링크를 보냅니다.</p>
          </div>
        </section>
        <ResetRequestForm />
      </main>
    </>
  );
}
