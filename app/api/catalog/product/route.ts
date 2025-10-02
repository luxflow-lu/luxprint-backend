import { NextRequest } from 'next/server';
import { getProduct } from '@/src/lib/printful';
import { jsonCors, preflight } from '@/src/lib/cors';

export const dynamic = 'force-dynamic';

export async function OPTIONS(req: NextRequest) { return preflight(req); }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id') || 0);
  if (!id) return jsonCors(req, { error: 'Missing id' }, { status: 400 });
  try {
    const data = await getProduct(id);
    const product = (data as any)?.result || (data as any)?.product || data || {};
    const placements = product.available_placements || product.placements || product.print_areas || [];
    const options = product.options || product.product_options || [];
    return jsonCors(req, { product: { ...product, placements, options } });
  } catch (e: any) {
    return jsonCors(req, { error: e.message || 'PF error' }, { status: 500 });
  }
}
