import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import type { CheckoutPayload, CartItem } from '@/src/lib/types';
import { computeUnitAmountCents, currency } from '@/src/lib/pricing';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
const ALLOW_DATAURL_IN_METADATA = false; // on évite d'envoyer de gros data:URL à Stripe

function cleanItem(i: CartItem) {
  return {
    ...i,
    designs: (i.designs || []).map(d => ({
      placement: String(d.placement || 'front'),
      technique: d.technique ? String(d.technique) : undefined,
      layers: (d.layers || []).filter(l => l && l.type === 'file' && l.url),
    })),
    options: (i.options || []).map(o => ({ id: String(o.id), value: String(o.value) })),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CheckoutPayload;
    const items = (body?.items || []).map(cleanItem).filter(i => i.variant_id && i.quantity > 0);
    if (!items.length) return NextResponse.json({ error: 'No items' }, { status: 400 });

    // Construit les line_items Stripe
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    for (const it of items) {
      const unit_amount = await computeUnitAmountCents({ usd_base: it.usd_base, fallback_unit_price: it.unit_price });
      if (!unit_amount) return NextResponse.json({ error: 'Invalid price' }, { status: 400 });

      const images: string[] = [];
      if (it.product_image) images.push(it.product_image);

      line_items.push({
        price_data: {
          currency: currency(),
          unit_amount,
          product_data: {
            name: it.product_name || 'Produit',
            images: images.length ? images : undefined,
            metadata: {
              printful_variant_id: String(it.variant_id),
              quantity: String(it.quantity),
              options_json: JSON.stringify(it.options || []),
              designs_json: JSON.stringify(it.designs || []),
              // on met le mockup en metadata (texte), Stripe n’affiche pas les images non publiques
              mockup_preview: (ALLOW_DATAURL_IN_METADATA && it.mockup_preview) ? String(it.mockup_preview).slice(0, 5000) : '',
            },
          },
        },
        quantity: it.quantity,
      });
    }

    const success_url = process.env.CHECKOUT_SUCCESS_URL || `${process.env.PUBLIC_BASE_URL}/success`;
    const cancel_url  = process.env.CHECKOUT_CANCEL_URL  || `${process.env.PUBLIC_BASE_URL}/cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      shipping_address_collection: { allowed_countries: ['FR','BE','DE','LU','NL','ES','IT'] },
      phone_number_collection: { enabled: true },
      line_items,
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Stripe error' }, { status: 500 });
  }
}
