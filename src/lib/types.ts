export type DesignLayer = { type: 'file'; url: string; filename?: string };
export type DesignEntry = { placement: string; technique?: string; layers: DesignLayer[] };

export type CartItem = {
  product_id?: number | string;
  product_name: string;
  product_image?: string;
  mockup_preview?: string;      // DataURL (pour email / log seulement)
  variant_id: number;
  quantity: number;
  unit_price?: number;          // cents EUR (fourni par le front)
  usd_base?: number;            // prix base USD (si tu veux pricing serveur)
  technique?: string;
  designs: DesignEntry[];
  options?: Array<{ id: string; value: string }>;
};

export type CheckoutPayload = {
  items: CartItem[];
};
