import "./globals.css";

export const metadata = {
  title: "Cohere CodeBot",
  description: "RAG-powered codebase analysis",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}