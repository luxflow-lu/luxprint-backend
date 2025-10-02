// app/api/stripe/checkout/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-06-20',
});

const SITE_URL = process.env.SITE_URL || 'https://luxprint.webflow.io';

function chunkString(str: string, n = 450) {
  const out: string[] = [];
  for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n));
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { items = [] } = await req.json().catch(() => ({}));
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Empty items' }, { status: 400 });
    }

    // Construire line_items Stripe + doubler les designs dans product_data.metadata (filet de sécurité)
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((it: any) => {
      const unit_amount = Number(it.unit_price || 0); // en cents
      const quantity = Number(it.quantity || 1);

      const slimDesigns = JSON.stringify({ designs: it.designs || [] });
      const designsChunks = chunkString(slimDesigns);
      const productMetadata: Record<string, string> = {
        variant_id: String(it.variant_id || ''),
      };
      if (designsChunks.length === 1) {
        productMetadata['designs'] = designsChunks[0];
      } else {
        productMetadata['designs_chunks'] = String(designsChunks.length);
        designsChunks.forEach((c, i) => (productMetadata[`designs_${i}`] = c));
      }

      return {
        quantity,
        price_data: {
          currency: 'usd', // (si vous passez en EUR côté pricing, adaptez ici)
          unit_amount: Math.max(unit_amount, 50), // Stripe n'aime pas 0 : on met un plancher, Printful recalcule.
          product_data: {
            name: it.product_name || 'LuxPrint Item',
            images: it.product_image ? [it.product_image] : [],
            metadata: productMetadata,
          },
        },
      };
    });

    // Stocker le panier complet (avec designs) en métadonnées de session (chunké)
    const cartStr = JSON.stringify({ items });
    const meta: Record<string, string> = {};
    const chunks = chunkString(cartStr);
    if (chunks.length === 1) {
      meta['cart'] = chunks[0];
    } else {
      meta['cart_chunks'] = String(chunks.length);
      chunks.forEach((c, i) => (meta[`cart_${i}`] = c));
    }
    if (process.env.PRINTFUL_STORE_ID) meta['store_id'] = process.env.PRINTFUL_STORE_ID;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url: `${SITE_URL}/merci?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/panier`,
      metadata: meta,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error('[checkout] fatal', e);
    return NextResponse.json({ error: e?.message || 'Checkout error' }, { status: 500 });
  }
}
