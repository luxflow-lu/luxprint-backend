// app/api/stripe/confirm/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-06-20',
});

async function readCartFromSession(session: Stripe.Checkout.Session & { line_items?: Stripe.ApiList<Stripe.LineItem> }) {
  // 1) session.metadata.cart ou cart_0..N
  let raw = (session.metadata as any)?.cart as string | undefined;
  if (!raw && (session.metadata as any)?.cart_chunks) {
    const n = Number((session.metadata as any).cart_chunks || 0) || 0;
    let buf = '';
    for (let i = 0; i < n; i++) buf += (session.metadata as any)[`cart_${i}`] || '';
    raw = buf;
  }
  if (raw) {
    try { return JSON.parse(raw); } catch { /* ignore */ }
  }

  // 2) Fallback : reconstruire à partir des métadonnées produit de chaque ligne
  const items: any[] = [];
  const lines = session?.line_items?.data || [];
  for (const li of lines) {
    const pm = (li?.price?.product as any)?.metadata || {};
    let designs: any[] = [];
    if (pm.designs) {
      try { designs = JSON.parse(pm.designs).designs || []; } catch {}
    } else if (pm.designs_chunks) {
      const n = Number(pm.designs_chunks || 0) || 0;
      let buf = '';
      for (let i = 0; i < n; i++) buf += pm[`designs_${i}`] || '';
      try { designs = JSON.parse(buf).designs || []; } catch {}
    }
    items.push({
      variant_id: Number(pm.variant_id || 0),
      quantity: Number(li.quantity || 1),
      unit_price: Number(li.price?.unit_amount || 0),
      designs,
    });
  }
  return { items };
}

function flattenFilesFromDesigns(designs: any[]) {
  // Printful -> items[].files = [{ placement, url }, ...]
  const files: { placement: string; url: string }[] = [];
  (designs || []).forEach((d) => {
    const placement = d.placement || 'front';
    (d.layers || []).forEach((layer: any) => {
      if (layer?.url) files.push({ placement, url: layer.url });
    });
  });
  return files;
}

function mapStripeAddress(session: Stripe.Checkout.Session) {
  const ship = (session.shipping_details?.address ||
                session.customer_details?.address) as Stripe.AddressParam | undefined;
  const name = (session.shipping_details?.name ||
                session.customer_details?.name) || 'Customer';
  return {
    name,
    address1: ship?.line1 || '—',
    address2: ship?.line2 || '',
    city: ship?.city || '',
    state_code: (ship as any)?.state || '',
    country_code: ship?.country || 'LU',
    zip: ship?.postal_code || '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json().catch(() => ({}));
    if (!session_id) return NextResponse.json({ ok: false, error: 'Missing session_id' }, { status: 400 });

    // Récupérer la session + ses line_items (produits étendus)
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items.data.price.product', 'customer_details', 'shipping_details'],
    }) as Stripe.Checkout.Session & { line_items?: Stripe.ApiList<Stripe.LineItem> };

    // Recomposer le panier
    const cart = await readCartFromSession(session);
    const items = (cart?.items || []).map((it: any) => ({
      variant_id: Number(it.variant_id || 0),
      quantity: Number(it.quantity || 1),
      files: flattenFilesFromDesigns(it.designs || []),
    }));

    if (!items.length) {
      return NextResponse.json({ ok: false, error: 'Empty items in cart' }, { status: 200 });
    }
    for (const it of items) {
      if (!it.files?.length) {
        return NextResponse.json({ ok: false, error: 'No design layers provided' }, { status: 200 });
      }
    }

    // Construire la commande Printful
    const pfToken = process.env.PRINTFUL_TOKEN_ORDERS || process.env.PRINTFUL_TOKEN || '';
    const storeId = process.env.PRINTFUL_STORE_ID || '';
    const recipient = mapStripeAddress(session);

    const payload = {
      external_id: session.id,
      recipient,
      items,
      // confirm: true, // activer si vous voulez envoyer direct à la prod
    };

    const r = await fetch('https://api.printful.com/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pfToken}`,
        'Content-Type': 'application/json',
        ...(storeId ? { 'X-PF-Store-Id': storeId } : {}),
      },
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j?.error && !j?.result)) {
      return NextResponse.json({ ok: false, error: j?.error || 'Printful error', printful: j }, { status: 200 });
    }

    const orderId = j?.result?.id || j?.result?.order?.id || j?.id;
    return NextResponse.json({ ok: true, printful_order_id: orderId, printful: j, store_id: storeId }, { status: 200 });
  } catch (e: any) {
    console.error('[confirm] fatal', e);
    return NextResponse.json({ ok: false, error: e?.message || 'Confirm error' }, { status: 500 });
  }
}
