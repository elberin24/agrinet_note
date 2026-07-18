import "./globals.css";

export const metadata = {
  title: "취재수첩",
  description: "기자를 위한 취재 기록 앱",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
