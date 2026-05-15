import { useAccount } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getMerchant, deleteMerchant, updateMerchant, MerchantInfo, NotFoundError } from '../api';
import Layout from '../components/Layout';

export default function Settings() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // Fixed address editing
  const [useFixed, setUseFixed] = useState(false);
  const [fixedAddr, setFixedAddr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (!isConnected) { navigate('/', { replace: true }); return; }
    if (address) {
      getMerchant(address)
        .then((m) => {
          setMerchant(m);
          setUseFixed(!!m.fixed_receive_address);
          setFixedAddr(m.fixed_receive_address || '');
        })
        .catch((err) => {
          if (err instanceof NotFoundError) navigate('/setup', { replace: true });
        });
    }
  }, [isConnected, address]);

  const saveAddressMode = async () => {
    if (!address) return;
    setSaving(true);
    setSaveMsg('');
    setError('');
    try {
      const newAddr = useFixed ? fixedAddr.trim() : null;
      if (useFixed && !newAddr?.match(/^0x[a-fA-F0-9]{40}$/)) {
        setError('Enter a valid EVM address (0x...)');
        setSaving(false);
        return;
      }
      const updated = await updateMerchant({
        wallet_address: address,
        fixed_receive_address: newAddr,
      });
      setMerchant(updated);
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
    setSaving(false);
  };

  const doReset = async () => {
    if (!address) return;
    setError('');
    setDeleting(true);
    try {
      await deleteMerchant(address);
      navigate('/setup', { replace: true });
    } catch (e: unknown) {
      setError((e as Error).message);
      setDeleting(false);
    }
  };

  if (!merchant) return <Layout><p style={{ textAlign: 'center', color: '#888', padding: 48 }}>Loading...</p></Layout>;

  return (
    <Layout>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: 24, marginBottom: 4, textAlign: 'center' }}>Settings</h1>
          <p style={{ textAlign: 'center', color: '#666', fontSize: 14, marginBottom: 24 }}>Merchant configuration</p>

          <InfoRow label="Business Name" value={merchant.name} />
          <InfoRow label="Wallet" value={merchant.wallet_address} />
          <InfoRow label="Webhook URL" value={merchant.webhook_url || 'Not configured'} />
          <InfoRow label="Created" value={new Date(merchant.created_at).toLocaleDateString()} />
        </div>

        {/* Address Mode */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>Receive Address Mode</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
            Choose how payment addresses are generated for each order.
          </p>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
            <input
              type="radio"
              checked={!useFixed}
              onChange={() => setUseFixed(false)}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Unique address per order (default)</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                Each payment gets a unique address derived from your xpub. Better privacy and easier to match payments to orders.
              </div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '12px 0' }}>
            <input
              type="radio"
              checked={useFixed}
              onChange={() => setUseFixed(true)}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Single fixed address</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                All payments go to one address. Simpler, but harder to match payments if multiple orders are open at the same time.
              </div>
              {useFixed && (
                <input
                  type="text"
                  value={fixedAddr}
                  onChange={(e) => setFixedAddr(e.target.value)}
                  placeholder="0x..."
                  style={{
                    width: '100%', marginTop: 8, padding: '10px 12px', border: '1px solid #e2e8f0',
                    borderRadius: 8, fontSize: 13, fontFamily: 'monospace', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              )}
            </div>
          </label>

          <button
            onClick={saveAddressMode}
            disabled={saving}
            style={{
              width: '100%', marginTop: 16, padding: 12, background: '#0f172a', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : saveMsg || 'Save'}
          </button>
          {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>

        {/* Danger Zone */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <h3 style={{ fontSize: 15, color: '#b91c1c', marginBottom: 8 }}>Reconfigure Store</h3>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
            Set up a new wallet and get new API credentials. This will delete all existing payment history.
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              width: '100%', padding: 12, background: '#fff', color: '#dc2626',
              border: '2px solid #fecaca', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Reconfigure Merchant
          </button>
        </div>
      </div>

      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 16, maxWidth: 440, width: '100%',
            padding: '32px 24px', textAlign: 'center',
          }}>
            <h2 style={{ fontSize: 20, color: '#b91c1c', marginBottom: 12 }}>Are you sure?</h2>
            <p style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>This will permanently delete your current configuration.</p>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 13, color: '#991b1b', margin: '16px 0', textAlign: 'left' }}>
              <strong>This action will:</strong>
              <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                <li>Delete your current merchant profile</li>
                <li>Invalidate your existing API key</li>
                <li>Delete all payment history</li>
              </ul>
            </div>
            <p style={{ fontSize: 13, color: '#888' }}>Your funds are safe — they remain in your wallet controlled by your seed phrase.</p>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{
                flex: 1, padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: 'pointer', border: 'none', background: '#f3f4f6', color: '#555',
              }}>Cancel</button>
              <button onClick={doReset} disabled={deleting} style={{
                flex: 1, padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: 'pointer', border: 'none', background: '#dc2626', color: '#fff',
              }}>
                {deleting ? 'Deleting...' : 'Yes, Reconfigure'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
      <span style={{ color: '#888', fontWeight: 500 }}>{label}</span>
      <span style={{ color: '#1a1a1a', fontWeight: 600, wordBreak: 'break-all' as const, textAlign: 'right' as const, maxWidth: '60%' }}>{value}</span>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 2px 12px rgba(0,0,0,.08)',
  padding: '32px 24px',
};
