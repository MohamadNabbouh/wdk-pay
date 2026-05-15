import { useAccount } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { listIntents, getMerchant, IntentSummary, MerchantInfo } from '../api';
import Layout from '../components/Layout';

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [intents, setIntents] = useState<IntentSummary[]>([]);

  useEffect(() => {
    if (!isConnected) { navigate('/', { replace: true }); return; }
    if (address) {
      getMerchant(address).then(setMerchant).catch(() => navigate('/setup', { replace: true }));
      refreshIntents();
    }
  }, [isConnected, address]);

  const refreshIntents = async () => {
    if (!address) return;
    try { setIntents((await listIntents(address)).data); } catch {}
  };

  const confirmedCount = intents.filter((i) => i.status === 'confirmed').length;
  const totalReceived = intents
    .filter((i) => i.status === 'confirmed' && i.paid_amount)
    .reduce((sum, i) => sum + parseFloat(i.paid_amount || '0'), 0);

  return (
    <Layout>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Payments" value={String(intents.length)} />
        <StatCard label="Confirmed" value={String(confirmedCount)} color="#059669" />
        <StatCard label="Received" value={`${totalReceived.toFixed(2)} USDT`} color="#2563eb" />
      </div>

      {/* Merchant info */}
      {merchant && (
        <div style={{ ...cardStyle, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>{merchant.name}</h2>
            <p style={{ fontSize: 13, color: '#888' }}>
              Webhook: {merchant.webhook_url || 'Not configured'}
            </p>
          </div>
          <button
            onClick={() => navigate('/settings')}
            style={{ padding: '8px 16px', background: '#f3f4f6', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#555', cursor: 'pointer' }}
          >
            Settings
          </button>
        </div>
      )}

      {/* Payments table */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18 }}>Recent Payments</h2>
          <button onClick={refreshIntents} style={{ padding: '6px 14px', background: '#f3f4f6', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#555', cursor: 'pointer' }}>
            Refresh
          </button>
        </div>
        {intents.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['Intent', 'Order', 'Amount', 'Chain', 'Status', 'Created'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', color: '#888', fontSize: 12, textTransform: 'uppercase' as const }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {intents.map((i) => (
                <tr key={i.id}>
                  <td style={tdStyle}>
                    <a href={`/pay/${i.id}`} target="_blank" rel="noopener" style={{ color: '#2563eb', textDecoration: 'none', fontFamily: 'monospace', fontSize: 12 }}>
                      {i.id.slice(0, 16)}...
                    </a>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{i.order_id}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{parseFloat(i.amount).toFixed(2)} USDT</td>
                  <td style={tdStyle}>
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{i.chain}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}><StatusBadge status={i.status} /></td>
                  <td style={{ ...tdStyle, fontSize: 12, color: '#888' }}>{new Date(i.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: 32, color: '#aaa', fontSize: 14 }}>
            No payments yet. Use the API or SDK to create payment intents.
          </div>
        )}
      </div>
    </Layout>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: color || '#1a1a1a' }}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    waiting: { bg: '#fefce8', fg: '#a16207' },
    confirmed: { bg: '#ecfdf5', fg: '#047857' },
    cancelled: { bg: '#fef2f2', fg: '#b91c1c' },
  };
  const c = colors[status] || { bg: '#f3f4f6', fg: '#555' };
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg }}>
      {status}
    </span>
  );
}

const cardStyle = {
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 1px 6px rgba(0,0,0,.06)',
  padding: 24,
};

const tdStyle = { padding: '10px 12px', borderBottom: '1px solid #f3f4f6' };
