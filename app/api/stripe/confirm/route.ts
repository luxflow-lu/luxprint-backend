import { NextRequest } from 'next/server';
import Stripe from 'stripe';

// Si tu utilises le helper CORS que je t'ai donné :
import { jsonCors, preflight } from '@/src/lib/cors';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20',
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json().catch(() => ({}));
    if (!session_id) {
      return jsonCors(req, { ok: false, error: 'missing session_id' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['payment_intent'],
    });

    const payment_status = session.payment_status; // 'paid' | 'unpaid' | 'no_payment_required'
    const pi =
      typeof session.payment_intent === 'string' ? null : session.payment_intent;

    const printful_order_id =
      (session.metadata && session.metadata.printful_order_id) ||
      (pi?.metadata && (pi.metadata as any).printful_order_id) ||
      null;

    const store_id =
      (session.metadata && session.metadata.printful_store_id) ||
      (pi?.metadata && (pi.metadata as any).printful_store_id) ||
      process.env.PRINTFUL_STORE_ID ||
      null;

    const ok = payment_status === 'paid';

    return jsonCors(req, {
      ok,
      payment_status,
      printful_order_id,
      store_id,
      session: {
        id: session.id,
        amount_total: session.amount_total,
        currency: session.currency,
      },
    });
  } catch (e: any) {
    return jsonCors(req, { ok: false, error: e.message || 'confirm failed' }, { status: 500 });
  }
}
