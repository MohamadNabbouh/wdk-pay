import { useAccount } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ethers } from 'ethers';
import { createMerchant } from '../api';
import Layout from '../components/Layout';

export default function Setup() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [seed, setSeed] = useState('');
  const [xpub, setXpub] = useState('');
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ api_key: string; webhook_secret: string } | null>(null);

  if (!isConnected) {
    navigate('/', { replace: true });
    return null;
  }

  const generateWallet = () => {
    setGenerating(true);
    try {
      const wallet = ethers.HDNodeWallet.createRandom();
      const mnemonic = wallet.mnemonic!.phrase;
      setSeed(mnemonic);
      const accountNode = ethers.HDNodeWallet.fromPhrase(mnemonic, "", "m/44'/60'/0'");
      setXpub(accountNode.neuter().extendedKey);
    } catch (e: unknown) {
      setError(`Failed to generate wallet: ${(e as Error).message}`);
    }
    setGenerating(false);
  };

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Business name is required.'); return; }
    if (!xpub) { setError('Generate a wallet first.'); return; }

    setSubmitting(true);
    try {
      const res = await createMerchant({
        name: name.trim(),
        xpub,
        wallet_address: address!,
        webhook_url: webhookUrl.trim() || undefined,
      });
      setResult(res);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
    setSubmitting(false);
  };

  if (result) {
    return (
      <Layout>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div style={cardStyle}>
            <h1 style={{ fontSize: 24, color: '#059669', textAlign: 'center', marginBottom: 4 }}>Setup Complete</h1>
            <p style={{ textAlign: 'center', color: '#666', fontSize: 14, marginBottom: 24 }}>
              {name} is ready to accept payments.
            </p>
            <CredentialField label="API Key" value={result.api_key} />
            <CredentialField label="Webhook Secret" value={result.webhook_secret} />
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 13, color: '#991b1b', marginTop: 20 }}>
              Save these credentials now — they will not be shown again.
            </div>
            <button onClick={() => navigate('/dashboard', { replace: true })} style={{ ...btnStyle, background: '#059669', marginTop: 20 }}>
              Go to Dashboard
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: 24, textAlign: 'center', marginBottom: 4 }}>Merchant Setup</h1>
          <p style={{ textAlign: 'center', color: '#666', fontSize: 14, marginBottom: 24 }}>
            Configure your payment gateway.
          </p>

          <Field label="Business Name" value={name} onChange={setName} placeholder="My Store" />

          {seed && (
            <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8, color: '#a16207' }}>Your Wallet Seed Phrase</h3>
              <p style={{ fontSize: 13, color: '#92400e', marginBottom: 8 }}>
                Write this down and store it securely. This is the ONLY time you will see it.
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: 13, background: '#fff', border: '1px solid #fde68a', borderRadius: 6, padding: 12, wordBreak: 'break-all' as const, marginBottom: 8, userSelect: 'all' as const }}>
                {seed}
              </div>
              <CopyButton text={seed} label="Copy Seed Phrase" />
              <p style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginTop: 8 }}>
                The server never sees this seed phrase. Only the xpub is sent.
              </p>
            </div>
          )}

          <button
            onClick={generateWallet}
            disabled={generating || !!xpub}
            style={{ ...btnStyle, background: xpub ? '#93c5fd' : '#2563eb', marginBottom: 16 }}
          >
            {xpub ? 'Wallet Generated' : 'Generate Wallet'}
          </button>

          {xpub && (
            <Field label="Extended Public Key (xpub)" value={xpub} readOnly />
          )}

          <Field label="Webhook URL (optional)" value={webhookUrl} onChange={setWebhookUrl} placeholder="https://yoursite.com/webhooks/wdkpay" />

          <button onClick={submit} disabled={submitting || !xpub} style={{ ...btnStyle, background: '#059669', marginTop: 8 }}>
            {submitting ? 'Setting up...' : 'Complete Setup'}
          </button>

          {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{error}</p>}
        </div>
      </div>
    </Layout>
  );
}

function Field({ label, value, onChange, placeholder, type, readOnly }: {
  label: string; value: string; onChange?: (v: string) => void; placeholder?: string; type?: string; readOnly?: boolean;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>{label}</label>
      <input
        type={type || 'text'}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8,
          fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' as const,
          background: readOnly ? '#f7f8fa' : '#fff',
        }}
      />
    </div>
  );
}

function CredentialField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f7f8fa', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}>
        <code style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' as const, color: '#333' }}>{value}</code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };
  return (
    <button
      onClick={copy}
      style={{
        border: 'none', background: copied ? '#059669' : '#e5e7eb', color: copied ? '#fff' : '#555',
        fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

function fallbackCopy(text: string, onSuccess: () => void) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); onSuccess(); } catch {}
  document.body.removeChild(ta);
}

const cardStyle = {
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 2px 12px rgba(0,0,0,.08)',
  padding: '32px 24px',
};

const btnStyle = {
  width: '100%',
  padding: '12px 20px',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
} as const;
