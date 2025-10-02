import { NextRequest, NextResponse } from 'next/server';
import { getVariants } from '@/src/lib/printful';

function normalizeVariants(arr: any[]) {
  return (arr || []).map((v) => {
    const id = v.id || v.variant_id || v.catalog_variant_id || v.external_id || v.sku;
    const size = v.size || v.size_name || v.size_code || v.attributes?.size || v.options?.size || '';
    const color = v.color || v.color_name || v.color_code || v.attributes?.color || v.options?.color || '';
    return { id, size: String(size || ''), color: String(color || '') };
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productId = Number(searchParams.get('product_id') || 0);
  if (!productId) return NextResponse.json({ error: 'Missing product_id' }, { status: 400 });
  try {
    const raw = await getVariants(productId);
    const variants = normalizeVariants(raw);
    return NextResponse.json({ variants });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'PF error' }, { status: 500 });
  }
}
