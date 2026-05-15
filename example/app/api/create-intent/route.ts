import { NextRequest, NextResponse } from 'next/server';
import WdkPay from 'wdk-pay';

const wdkPay = new WdkPay({
  apiKey: process.env.WDK_PAY_API_KEY!,
  baseUrl: process.env.WDK_PAY_BASE_URL,
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { amount, chain, productName } = body;

  const orderId = `ord_${Date.now()}`;

  try {
    const intent = await wdkPay.intents.create({
      amount,
      orderId,
      chain,
      metadata: { product: productName || 'Custom' },
    });

    return NextResponse.json({
      id: intent.id,
      address: intent.address,
      amount: intent.amount,
      chain: intent.chain,
      status: intent.status,
      order_id: orderId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create intent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
