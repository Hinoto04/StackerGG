import { LoginForm } from "./LoginForm";
import { getCurrentUser } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }

  return (
    <>
      <SiteHeader active="login" />
      <main className="site-shell content auth-page">
        <section className="page-head">
          <div>
            <div className="kicker">ACCOUNT</div>
            <h1>로그인</h1>
            <p>아이디와 비밀번호 또는 외부 계정으로 로그인합니다.</p>
          </div>
        </section>
        <LoginForm />
      </main>
    </>
  );
}
