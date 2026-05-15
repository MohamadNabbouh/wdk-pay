'use client';

import { useState, useEffect, useCallback } from 'react';
import QRCode from 'react-qr-code';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { parseUnits, encodeFunctionData } from 'viem';

type PayMethod = 'qr' | 'wallet';

interface IntentData {
  id: string;
  address: string;
  amount: string;
  chain: string;
  status: string;
  order_id: string;
  productName: string;
}

interface ChainInfo {
  chainId: number;
  usdtContract: string;
  explorer: string;
  decimals: number;
}

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

function buildEip681Uri(address: string, amount: string, chainId: number, usdtContract: string, decimals: number): string {
  const [whole, frac = ''] = parseFloat(amount).toFixed(decimals).split('.');
  const wei = BigInt(whole + frac).toString();
  return `ethereum:${usdtContract}@${chainId}/transfer?address=${address}&uint256=${wei}`;
}

function fallbackCopy(text: string, onDone: () => void) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); onDone(); } catch {}
  document.body.removeChild(ta);
}

function CopyBtn({ text }: { text: string }) {
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
    <button onClick={copy} style={{
      border: 'none', background: copied ? '#059669' : '#e2e8f0', color: copied ? '#fff' : '#64748b',
      fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
    }}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function WalletPay({ intent, chainInfo }: { intent: IntentData; chainInfo: ChainInfo }) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const needsChainSwitch = isConnected && chainId !== chainInfo.chainId;

  const handlePay = () => {
    if (needsChainSwitch) {
      switchChain({ chainId: chainInfo.chainId });
      return;
    }

    writeContract({
      address: chainInfo.usdtContract as `0x${string}`,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [
        intent.address as `0x${string}`,
        parseUnits(intent.amount, chainInfo.decimals),
      ],
      chainId: chainInfo.chainId,
    });
  };

  if (!isConnected) {
    return (
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Connect your wallet to pay directly from the checkout.
        </p>
        <ConnectButton />
      </div>
    );
  }

  if (txHash) {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{
          background: isSuccess ? '#ecfdf5' : '#eff6ff',
          border: `1px solid ${isSuccess ? '#a7f3d0' : '#bfdbfe'}`,
          borderRadius: 10, padding: 16, textAlign: 'center',
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: isSuccess ? '#047857' : '#1d4ed8', marginBottom: 8 }}>
            {isSuccess ? 'Transaction confirmed!' : isConfirming ? 'Confirming...' : 'Transaction sent!'}
          </p>
          <a
            href={`${chainInfo.explorer}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#2563eb', wordBreak: 'break-all' }}
          >
            {txHash.slice(0, 16)}...{txHash.slice(-12)} ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'left', marginBottom: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 12,
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Connected</div>
          <code style={{ fontSize: 12, color: '#334155' }}>{address?.slice(0, 8)}...{address?.slice(-6)}</code>
        </div>
        <ConnectButton.Custom>
          {({ openAccountModal }) => (
            <button onClick={openAccountModal} style={{
              background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
              fontSize: 11, color: '#64748b', padding: '4px 8px', cursor: 'pointer',
            }}>
              Switch
            </button>
          )}
        </ConnectButton.Custom>
      </div>

      <button
        onClick={handlePay}
        disabled={isPending}
        style={{
          width: '100%', padding: 14, background: needsChainSwitch ? '#2563eb' : '#0f172a', color: '#fff',
          border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? 'Confirm in wallet...' : needsChainSwitch ? `Switch to ${intent.chain}` : `Pay ${parseFloat(intent.amount).toFixed(2)} USDT`}
      </button>

      {error && (
        <p style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>
          {error.message.includes('User rejected') ? 'Transaction rejected.' : error.message.slice(0, 120)}
        </p>
      )}
    </div>
  );
}

export default function Checkout({
  intent,
  chainInfo,
  chainName,
  onBack,
}: {
  intent: IntentData;
  chainInfo: ChainInfo;
  chainName: string;
  onBack: () => void;
}) {
  const [status, setStatus] = useState(intent.status);
  const [paidAmount, setPaidAmount] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>('wallet');

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/intent?id=${intent.id}`);
      const data = await res.json();
      if (data.status) setStatus(data.status);
      if (data.paid_amount) setPaidAmount(data.paid_amount);
      if (data.paid_tx_hash) setTxHash(data.paid_tx_hash);
    } catch {}
  }, [intent.id]);

  useEffect(() => {
    if (status === 'confirmed' || status === 'cancelled') return;
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [status, pollStatus]);

  const eip681 = buildEip681Uri(intent.address, intent.amount, chainInfo.chainId, chainInfo.usdtContract, chainInfo.decimals);
  const isTerminal = status === 'confirmed' || status === 'cancelled';
  const isDetected = status === 'waiting' && paidAmount;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        {/* Back button */}
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: '#64748b', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', marginBottom: 16, padding: 0, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          ← Back to store
        </button>

        <div style={{
          background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,.08)',
          padding: '32px 24px', textAlign: 'center',
        }}>
          {/* Header */}
          <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            {intent.productName}
          </p>
          <div style={{
            display: 'inline-block', background: '#eff6ff', color: '#2563eb',
            padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, marginBottom: 16,
          }}>
            {chainName}
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 4 }}>
            {parseFloat(intent.amount).toFixed(2)} <span style={{ fontSize: 20, fontWeight: 500, color: '#64748b' }}>USDT</span>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 24 }}>Order {intent.order_id}</p>

          {/* Payment method tabs */}
          {!isTerminal && (
            <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              {(['wallet', 'qr'] as const).map((m) => (
                <button key={m} onClick={() => setPayMethod(m)} style={{
                  flex: 1, padding: '10px 0', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: payMethod === m ? '#0f172a' : '#f8fafc',
                  color: payMethod === m ? '#fff' : '#64748b',
                }}>
                  {m === 'wallet' ? 'Pay with Wallet' : 'Scan QR / Manual'}
                </button>
              ))}
            </div>
          )}

          {/* Wallet pay method */}
          {!isTerminal && payMethod === 'wallet' && (
            <WalletPay intent={intent} chainInfo={chainInfo} />
          )}

          {/* QR Code method */}
          {!isTerminal && payMethod === 'qr' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                <div style={{ background: '#fff', padding: 12, borderRadius: 12, border: '1px solid #f1f5f9' }}>
                  <QRCode value={eip681} size={200} />
                </div>
              </div>
              <div style={{ textAlign: 'left', marginBottom: 20 }}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Send to address</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                    <code style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', color: '#334155' }}>{intent.address}</code>
                    <CopyBtn text={intent.address} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Exact amount</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                    <code style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', color: '#334155' }}>{parseFloat(intent.amount).toFixed(2)} USDT</code>
                    <CopyBtn text={parseFloat(intent.amount).toFixed(2)} />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Status bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: 14, borderRadius: 10, fontSize: 14, fontWeight: 500,
            ...(status === 'confirmed'
              ? { background: '#ecfdf5', color: '#047857' }
              : status === 'cancelled'
                ? { background: '#fef2f2', color: '#b91c1c' }
                : isDetected
                  ? { background: '#eff6ff', color: '#1d4ed8' }
                  : { background: '#fefce8', color: '#a16207' }),
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: status === 'confirmed' ? '#059669'
                : status === 'cancelled' ? '#dc2626'
                  : isDetected ? '#3b82f6' : '#eab308',
              animation: isTerminal ? 'none' : 'pulse 1.5s infinite',
            }} />
            {status === 'confirmed' ? 'Payment confirmed!'
              : status === 'cancelled' ? 'Payment cancelled.'
                : isDetected ? 'Payment detected, confirming...'
                  : 'Waiting for payment...'}
          </div>

          {/* Tx link */}
          {txHash && (
            <a
              href={`${chainInfo.explorer}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', marginTop: 12, fontSize: 12, color: '#2563eb', textDecoration: 'none' }}
            >
              View transaction ↗
            </a>
          )}

          {/* Success: back to store */}
          {status === 'confirmed' && (
            <button onClick={onBack} style={{
              width: '100%', marginTop: 20, padding: 14, background: '#059669', color: '#fff',
              border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>
              Continue Shopping
            </button>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#cbd5e1', marginTop: 16 }}>
          Powered by WDK Pay
        </p>

        <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }`}</style>
      </div>
    </div>
  );
}
