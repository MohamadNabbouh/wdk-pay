import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Link, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';

const styles = {
  nav: {
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '12px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  } as const,
  brand: { fontSize: 16, fontWeight: 700, color: '#1a1a1a', textDecoration: 'none' } as const,
  brandAccent: { color: '#059669' } as const,
  links: { display: 'flex', gap: 12 } as const,
  link: (active: boolean) => ({
    fontSize: 13,
    fontWeight: 500,
    color: active ? '#1a1a1a' : '#666',
    textDecoration: 'none',
    padding: '4px 8px',
    borderRadius: 6,
    background: active ? '#f3f4f6' : 'transparent',
  }),
  container: { maxWidth: 960, margin: '0 auto', padding: 24 } as const,
};

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div>
      <nav style={styles.nav}>
        <Link to="/" style={styles.brand}>
          <span style={styles.brandAccent}>WDK</span> Pay
        </Link>
        <div style={styles.links}>
          <Link to="/dashboard" style={styles.link(location.pathname === '/dashboard')}>Dashboard</Link>
          <Link to="/settings" style={styles.link(location.pathname === '/settings')}>Settings</Link>
        </div>
        <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
      </nav>
      <div style={styles.container}>
        {children}
      </div>
    </div>
  );
}
