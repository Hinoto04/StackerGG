import { getCurrentUser, isAdmin } from "@/lib/auth";

type ActiveNav = "cards" | "card-new" | "decks" | "login";

export async function SiteHeader({ active }: { active?: ActiveNav }) {
  const user = await getCurrentUser();
  const admin = isAdmin(user);

  return (
    <header className="site-shell site-header">
      <a className="brand" href="/">
        <span className="brand-mark">S</span>
        <span>
          <strong>StackerDB</strong>
          <small>Card Database</small>
        </span>
      </a>
      <nav className="main-nav" aria-label="주 메뉴">
        <a aria-current={active === "cards" ? "page" : undefined} href="/">
          카드
        </a>
        {admin ? (
          <a aria-current={active === "card-new" ? "page" : undefined} href="/cards/new">
            카드 추가
          </a>
        ) : null}
        <a aria-current={active === "decks" ? "page" : undefined} href="/decks">
          덱
        </a>
      </nav>
      <div className="account-actions">
        {user ? (
          <>
            <span className="account-name">{user.displayName || user.loginId}</span>
            <form action="/logout" method="post">
              <button type="submit">로그아웃</button>
            </form>
          </>
        ) : (
          <a aria-current={active === "login" ? "page" : undefined} href="/login">
            로그인
          </a>
        )}
      </div>
    </header>
  );
}
