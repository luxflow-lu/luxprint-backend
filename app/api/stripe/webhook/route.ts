import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20',
});

// --- Helpers
function allowlistRegex(): RegExp {
  const def = '^https:\\/\\/(?:[a-z0-9-]+\\.)?(?:ucarecdn\\.com|ucarecd\\.net)\\/';
  try {
    return new RegExp(process.env.ALLOWLIST_REGEX || def, 'i');
  } catch {
    return new RegExp(def, 'i');
  }
}

function parseJSONSafe<T = any>(txt?: string): T | null {
  try {
    if (!txt) return null;
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

type FrontDesign = {
  placement: string; // 'front' | 'back' | ...
  technique?: string;
  layers: Array<{ type: 'file'; url: string; filename?: string }>;
};

// Map designs[] -> Printful "files"[] (very permissive; placement kept as "type")
function buildPrintfulFiles(designs: FrontDesign[], urlAllow: RegExp) {
  const files: Array<{ url: string; type?: string }> = [];
  for (const d of designs || []) {
    for (const l of d.layers || []) {
      if (l.type !== 'file' || !l.url) continue;
      if (!urlAllow.test(l.url)) continue;
      files.push({ url: l.url, type: d.placement }); // Printful accepte 'type' (front/back/…)
    }
  }
  return files.length ? files : null;
}

function normalizeOptions(options: Array<{ id: string; value: string }>) {
  return (options || []).map(o => ({ id: String(o.id), value: String(o.value) }));
}

async function createPrintfulOrder(payload: any, token: string) {
  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      `Printful error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature') || '';
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!secret) {
    return new NextResponse('Missing STRIPE_WEBHOOK_SECRET', { status: 500 });
  }

  // 1) Lire le RAW body (obligatoire pour vérifier la signature)
  const raw = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err: any) {
    return new NextResponse(`⚠️  Signature invalide: ${err.message}`, { status: 400 });
  }

  // 2) Gérer les événements d'intérêt
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Récupérer les line items + expand du product pour accéder aux metadata
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ['data.price.product'],
    });

    const urlAllow = allowlistRegex();

    // Construire les items Printful
    const items: Array<{
      external_id?: string;
      variant_id: number;
      quantity: number;
      files: Array<{ url: string; type?: string }>;
      options?: Array<{ id: string; value: string }>;
    }> = [];

    for (const li of lineItems.data) {
      const qty = li.quantity || 1;
      // produit on-the-fly créé via price_data.product_data
      const prod = (li.price?.product && typeof li.price.product !== 'string')
        ? li.price.product
        : null;

      const md = (prod?.metadata || {}) as Record<string, string>;
      const variant_id = Number(md.printful_variant_id || 0);
      if (!variant_id) continue;

      const options_json = md.options_json || '[]';
      const designs_json = md.designs_json || '[]';

      const options = normalizeOptions(parseJSONSafe(options_json) || []);
      const designs = (parseJSONSafe<FrontDesign[]>(designs_json) || []);
      const files = buildPrintfulFiles(designs, urlAllow);

      if (!files || !files.length) {
        // pas de fichiers -> on saute l'item (ou on pourrait créer un item "sans print")
        continue;
      }

      items.push({
        external_id: String(variant_id), // optionnel
        variant_id,
        quantity: qty,
        files,
        options,
      });
    }

    // Rien à envoyer ?
    if (!items.length) {
      // on loggue et sort en 200 pour ne pas réessayer indéfiniment
      console.warn('[webhook] no printable items; session:', session.id);
      return new NextResponse('no items', { status: 200 });
    }

    // Récupérer les infos destinataire depuis la session
    const cd = session.customer_details;
    const addr = cd?.address || {};
    const recipient = {
      name: cd?.name || '',
      email: cd?.email || '',
      phone: cd?.phone || '',
      address1: addr.line1 || '',
      address2: addr.line2 || '',
      city: addr.city || '',
      state_code: (addr.state || ''),
      country_code: (addr.country || ''),
      zip: (addr.postal_code || ''),
    };

    // Construire la commande Printful
    const orderPayload = {
      external_id: session.id, // utile pour suivi
      shipping: 'STANDARD',    // ajuste si besoin
      recipient,
      items,
    };

    const token = process.env.PRINTFUL_TOKEN || '';
    if (!token) throw new Error('Missing PRINTFUL_TOKEN');

    const created = await createPrintfulOrder(orderPayload, token);

    // Extraire l'ID commande Printful
    const orderId =
      created?.result?.id ||
      created?.data?.id ||
      created?.id ||
      created?.result?.order?.id ||
      null;

    // 3) Remonter l’ID en metadata côté Stripe (Session + PaymentIntent)
    try {
      await stripe.checkout.sessions.update(session.id, {
        metadata: {
          ...(session.metadata || {}),
          printful_order_id: orderId ? String(orderId) : '',
          printful_store_id: String(process.env.PRINTFUL_STORE_ID || ''),
        },
      });

      if (session.payment_intent && typeof session.payment_intent === 'string') {
        await stripe.paymentIntents.update(session.payment_intent, {
          metadata: {
            printful_order_id: orderId ? String(orderId) : '',
            printful_store_id: String(process.env.PRINTFUL_STORE_ID || ''),
          },
        });
      }
    } catch (e) {
      console.error('[webhook] unable to stamp metadata on Stripe', e);
      // on ne jette pas l'erreur, la commande Printful est déjà créée
    }

    return new NextResponse('ok', { status: 200 });
  }

  // Ping / autres évts
  return new NextResponse('ignored', { status: 200 });
}
