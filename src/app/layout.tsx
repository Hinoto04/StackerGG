import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StackerDB - 카드 데이터베이스",
  description: "StackerGG 카드 게임을 위한 카드 데이터베이스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
