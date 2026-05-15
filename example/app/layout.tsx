import Providers from './providers';

export const metadata = {
  title: 'WDK Pay Example Store',
  description: 'Example Next.js store with WDK Pay integration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#f0f2f5',
        margin: 0,
        minHeight: '100vh',
      }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
