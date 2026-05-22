import { LoginForm } from "./LoginForm";
import { getCurrentUser } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { getSafeRedirectPath } from "@/lib/redirect";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const nextPath = getSafeRedirectPath(next);
  const user = await getCurrentUser();

  if (user) {
    redirect(nextPath);
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
        <LoginForm nextPath={nextPath} />
      </main>
    </>
  );
}
