import { NextRequest, NextResponse } from 'next/server';
import WdkPay from 'wdk-pay';

const wdkPay = new WdkPay({
  apiKey: process.env.WDK_PAY_API_KEY!,
  baseUrl: process.env.WDK_PAY_BASE_URL,
});

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  try {
    const intent = await wdkPay.intents.get(id);
    return NextResponse.json(intent);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get intent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
