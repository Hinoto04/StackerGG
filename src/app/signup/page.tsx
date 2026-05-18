import { redirect } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
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
            <h1>회원가입</h1>
            <p>비밀번호는 해시 처리되어 저장됩니다.</p>
          </div>
        </section>
        <SignupForm />
      </main>
    </>
  );
}
