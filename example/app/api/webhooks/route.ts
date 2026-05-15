import { NextRequest, NextResponse } from 'next/server';
import WdkPay from 'wdk-pay';

const wdkPay = new WdkPay({
  apiKey: '', // not needed for webhook verification
  webhookSecret: process.env.WDK_PAY_WEBHOOK_SECRET,
});

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-wdkpay-signature') ?? '';

  let event;
  try {
    event = wdkPay.webhooks.constructEvent(body, signature);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  console.log('Webhook received:', event);

  if (event.event === 'intent.confirmed') {
    console.log(`Order ${event.data.order_id} paid! Amount: ${event.data.paid_amount} USDT`);
    // TODO: fulfill the order in your database
  }

  if (event.event === 'intent.cancelled') {
    console.log(`Order ${event.data.order_id} cancelled.`);
    // TODO: handle cancellation
  }

  return NextResponse.json({ received: true });
}
