import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMerchant, NotFoundError } from '../api';

export default function Landing() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) return;

    setChecking(true);
    getMerchant(address)
      .then(() => navigate('/dashboard', { replace: true }))
      .catch((err) => {
        if (err instanceof NotFoundError) {
          navigate('/setup', { replace: true });
        }
        // Other errors: stay on landing, user can retry
      })
      .finally(() => setChecking(false));
  }, [isConnected, address, navigate]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: 16,
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(0,0,0,.08)',
        maxWidth: 420,
        width: '100%',
        padding: '48px 24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8 }}>
          WDK Pay
        </div>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>
          Self-Custodial Checkout
        </h1>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
          Accept USDT payments on Arbitrum, Ethereum, Polygon, and Avalanche.
          No custody risk — funds go directly to your wallet.
        </p>

        {checking ? (
          <p style={{ color: '#888', fontSize: 14 }}>Checking account...</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <ConnectButton label="Connect Wallet to Start" />
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: 12, color: '#aaa' }}>
          Powered by Tether WDK
        </p>
      </div>
    </div>
  );
}
