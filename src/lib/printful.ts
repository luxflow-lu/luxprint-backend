import type { DesignEntry } from './types';

const PF_BASE_V2 = 'https://api.printful.com/v2';
const PF_BASE_V1 = 'https://api.printful.com';
const TOKEN = process.env.PRINTFUL_TOKEN || '';
const STORE_ID = process.env.PRINTFUL_STORE_ID || '';

async function pfFetch(url: string, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : await r.text();
  return { ok: r.ok, status: r.status, data };
}

/** Catalog proxy (v2 → v1 fallback) */
export async function getProduct(productId: number) {
  let r = await pfFetch(`${PF_BASE_V2}/catalog/products/${productId}`);
  if (r.ok) return r.data;
  r = await pfFetch(`${PF_BASE_V1}/catalog/products/${productId}`);
  if (r.ok) return r.data;
  throw new Error(`Printful product load failed (${r.status})`);
}
export async function getVariants(productId: number) {
  let r = await pfFetch(`${PF_BASE_V2}/catalog/variants?product_id=${productId}`);
  if (r.ok) return (r.data?.result || r.data?.variants || []);
  r = await pfFetch(`${PF_BASE_V1}/catalog/variants?product_id=${productId}`);
  if (r.ok) return (r.data?.result || r.data?.variants || []);
  throw new Error(`Printful variants load failed (${r.status})`);
}

/** Transforme design_map_json (front) → files[] (Printful) */
export function mapDesignsToFiles(designs: DesignEntry[]) {
  const out: Array<{ url: string; type: string; position?: string; filename?: string }> = [];
  for (const d of designs || []) {
    const pos = d.placement || 'front';
    for (const l of d.layers || []) {
      if (l.type !== 'file' || !l.url) continue;
      out.push({ url: l.url, type: pos, position: pos, filename: l.filename });
    }
  }
  return out;
}

/** Crée une commande regroupée Printful (une par checkout Stripe) */
export async function createPrintfulOrder(params: {
  external_id?: string;
  recipient: {
    name?: string; address1?: string; city?: string; country_code?: string;
    zip?: string; state_code?: string; phone?: string; email?: string;
  };
  items: Array<{
    variant_id: number;
    quantity: number;
    files: Array<{ url: string; type: string; position?: string; filename?: string }>;
    options?: Array<{ id: string; value: string }>;
  }>;
  packing_slip?: { email?: string; phone?: string; message?: string };
}) {
  const body: any = {
    external_id: params.external_id,
    recipient: params.recipient,
    items: params.items,
    store_id: STORE_ID || undefined,
    packing_slip: params.packing_slip,
  };
  const r = await pfFetch(`${PF_BASE_V1}/orders`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Printful order.create failed (${r.status}): ${JSON.stringify(r.data)}`);
  return r.data;
}
