import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/src/lib/printful';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id') || 0);
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    const data = await getProduct(id);
    const product = data?.result || data?.product || data || {};
    const placements = product.available_placements || product.placements || product.print_areas || [];
    const options = product.options || product.product_options || [];
    return NextResponse.json({ product: { ...product, placements, options } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'PF error' }, { status: 500 });
  }
}
