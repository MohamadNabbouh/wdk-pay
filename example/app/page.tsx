'use client';

import { useState } from 'react';
import Checkout from './checkout/Checkout';

const CHAINS = [
  { id: 'arbitrum', name: 'Arbitrum', color: '#2563eb' },
  { id: 'ethereum', name: 'Ethereum', color: '#627eea' },
  { id: 'polygon', name: 'Polygon', color: '#8247e5' },
  { id: 'avalanche', name: 'Avalanche', color: '#e84142' },
];

const CHAIN_INFO: Record<string, { chainId: number; usdtContract: string; explorer: string; decimals: number }> = {
  arbitrum: { chainId: 42161, usdtContract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', explorer: 'https://arbiscan.io', decimals: 6 },
  ethereum: { chainId: 1, usdtContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', explorer: 'https://etherscan.io', decimals: 6 },
  polygon: { chainId: 137, usdtContract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', explorer: 'https://polygonscan.com', decimals: 6 },
  avalanche: { chainId: 43114, usdtContract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', explorer: 'https://snowtrace.io', decimals: 6 },
};

const PRODUCTS = [
  { id: 'stickers', name: 'Digital Sticker Pack', price: 0.50, emoji: '🎨', desc: 'Collection of 12 unique stickers' },
  { id: 'wallpaper', name: 'Premium Wallpaper', price: 1.00, emoji: '🖼️', desc: '4K resolution, exclusive design' },
  { id: 'coffee', name: 'Dev Coffee', price: 2.00, emoji: '☕', desc: 'Fuel for your next coding session' },
  { id: 'license', name: 'Pro License Key', price: 5.00, emoji: '🔑', desc: 'Lifetime access, all features' },
];

interface CartItem {
  id: string;
  name: string;
  price: number;
  emoji: string;
  qty: number;
}

interface IntentData {
  id: string;
  address: string;
  amount: string;
  chain: string;
  status: string;
  order_id: string;
  productName: string;
}

export default function Store() {
  const [chain, setChain] = useState('arbitrum');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<IntentData | null>(null);

  const addToCart = (product: typeof PRODUCTS[0]) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, emoji: product.emoji, qty: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter((i) => i.qty > 0)
    );
  };

  const removeItem = (id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setError('');
    setLoading(true);
    try {
      const summary = cart.map((i) => `${i.qty}x ${i.name}`).join(', ');
      const res = await fetch('/api/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: cartTotal.toFixed(2), chain, productName: summary }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCheckout({ ...data, productName: summary });
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  if (checkout) {
    return (
      <Checkout
        intent={checkout}
        chainInfo={CHAIN_INFO[checkout.chain]}
        chainName={CHAINS.find((c) => c.id === checkout.chain)?.name || checkout.chain}
        onBack={() => { setCheckout(null); setCart([]); }}
      />
    );
  }

  const selectedChain = CHAINS.find((c) => c.id === chain)!;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>WDK Store</h1>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Example e-commerce integration</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                fontSize: 13, fontWeight: 600, background: '#fff', cursor: 'pointer',
                color: selectedChain.color,
              }}
            >
              {CHAINS.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* Products grid */}
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#475569', marginBottom: 16 }}>Products</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          {PRODUCTS.map((product) => {
            const inCart = cart.find((i) => i.id === product.id);
            return (
              <div key={product.id} style={{
                background: '#fff', borderRadius: 12, padding: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: inCart ? '2px solid #2563eb' : '1px solid #f1f5f9',
                display: 'flex', flexDirection: 'column', transition: 'border-color .15s',
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>{product.emoji}</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{product.name}</h3>
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, flex: 1 }}>{product.desc}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>${product.price.toFixed(2)}</span>
                  {inCart ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => updateQty(product.id, -1)} style={qtyBtnStyle}>-</button>
                      <span style={{ fontSize: 14, fontWeight: 600, minWidth: 20, textAlign: 'center' }}>{inCart.qty}</span>
                      <button onClick={() => updateQty(product.id, 1)} style={qtyBtnStyle}>+</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => addToCart(product)}
                      style={{
                        padding: '8px 16px', background: '#0f172a', color: '#fff', border: 'none',
                        borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Cart */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: 24,
          boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: '1px solid #f1f5f9',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#475569', margin: 0 }}>
              Cart {cartCount > 0 && <span style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>({cartCount} item{cartCount !== 1 ? 's' : ''})</span>}
            </h2>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
                Clear all
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <p style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '16px 0' }}>
              Your cart is empty. Add some products above.
            </p>
          ) : (
            <>
              {cart.map((item) => (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
                  borderBottom: '1px solid #f1f5f9',
                }}>
                  <span style={{ fontSize: 24 }}>{item.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>${item.price.toFixed(2)} each</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => updateQty(item.id, -1)} style={qtyBtnStyle}>-</button>
                    <span style={{ fontSize: 14, fontWeight: 600, minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                    <button onClick={() => updateQty(item.id, 1)} style={qtyBtnStyle}>+</button>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
                    ${(item.price * item.qty).toFixed(2)}
                  </div>
                  <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>
                    x
                  </button>
                </div>
              ))}

              {/* Total + Checkout */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 2 }}>Total</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    ${cartTotal.toFixed(2)} <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>USDT</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    display: 'inline-block', background: '#eff6ff', color: selectedChain.color,
                    padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  }}>
                    Pay on {selectedChain.name}
                  </div>
                  <button
                    onClick={handleCheckout}
                    disabled={loading}
                    style={{
                      padding: '12px 28px', background: '#0f172a', color: '#fff', border: 'none',
                      borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    {loading ? 'Creating...' : 'Checkout'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {error && (
          <p style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', marginTop: 16 }}>{error}</p>
        )}

        <p style={{ textAlign: 'center', fontSize: 12, color: '#cbd5e1', marginTop: 32 }}>
          Powered by WDK Pay
        </p>
      </main>
    </div>
  );
}

const qtyBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0',
  background: '#f8fafc', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155',
};
