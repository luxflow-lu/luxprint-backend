import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createPrintfulOrder, mapDesignsToFiles } from '@/src/lib/printful';
import type { DesignEntry } from '@/src/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function allowedUrl(url: string): boolean {
  const rx = process.env.ALLOWLIST_REGEX ? new RegExp(process.env.ALLOWLIST_REGEX) : /^https:\/\/(ucarecdn\.com)\//i;
  return rx.test(url || '');
}
function filterAllowedFiles(files: Array<{ url: string; type: string; position?: string; filename?: string }>) {
  return files.filter(f => allowedUrl(f.url));
}
async function readRawBody(req: Request): Promise<Buffer> {
  const arr = await req.arrayBuffer();
  return Buffer.from(arr);
}

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
  const sig = req.headers.get('stripe-signature') || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  let event: Stripe.Event;

  try {
    const raw = await readRawBody(req as any);
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json({ error: `Signature verification failed: ${err.message}` }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });

      // Adresse client (Stripe)
      const ship = session.shipping_details;
      const recipient = {
        name: ship?.name || session.customer_details?.name || '',
        address1: ship?.address?.line1 || '',
        city: ship?.address?.city || '',
        country_code: ship?.address?.country || '',
        zip: ship?.address?.postal_code || '',
        state_code: ship?.address?.state || '',
        phone: session.customer_details?.phone || '',
        email: session.customer_details?.email || '',
      };

      const pfItems: Array<{
        variant_id: number; quantity: number;
        files: Array<{ url: string; type: string; position?: string; filename?: string }>;
        options?: Array<{ id: string; value: string }>;
      }> = [];

      for (const li of lineItems.data) {
        const product = li?.price?.product as Stripe.Product;
        const meta = product?.metadata || {};

        const variantId = Number(meta.printful_variant_id || '0');
        const quantity  = Number(li?.quantity || meta.quantity || 1);

        const designs: DesignEntry[] = JSON.parse(meta.designs_json || '[]');
        const options: Array<{ id: string; value: string }> = JSON.parse(meta.options_json || '[]');

        // map designs -> files et filtration allowlist
        const files = filterAllowedFiles(mapDesignsToFiles(designs));
        if (!variantId || !files.length) continue;

        pfItems.push({ variant_id: variantId, quantity, files, options: options.length ? options : undefined });
      }

      if (!pfItems.length) {
        return NextResponse.json({ error: 'No valid items for Printful' }, { status: 400 });
      }

      const order = await createPrintfulOrder({
        external_id: session.id,
        recipient,
        items: pfItems,
        packing_slip: { email: recipient.email, phone: recipient.phone },
      });

      return NextResponse.json({ received: true, printful_order: order });
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Webhook error' }, { status: 500 });
  }
}
