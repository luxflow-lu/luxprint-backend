// juste après la création Printful :
const created = /* … l’objet de création Printful … */;
const orderId = created?.result?.id || created?.data?.id || created?.id;

// On remonte l’info dans Stripe (session + PI)
try {
  await stripe.checkout.sessions.update(event.data.object.id, {
    metadata: {
      ...(session?.metadata || {}),
      printful_order_id: String(orderId || ''),
      printful_store_id: String(process.env.PRINTFUL_STORE_ID || ''),
    },
  });

  if (session?.payment_intent && typeof session.payment_intent !== 'string') {
    await stripe.paymentIntents.update(session.payment_intent.id, {
      metadata: {
        ...(session.payment_intent.metadata || {}),
        printful_order_id: String(orderId || ''),
        printful_store_id: String(process.env.PRINTFUL_STORE_ID || ''),
      },
    });
  }
} catch (e) {
  console.error('[webhook] unable to stamp metadata on Stripe:', e);
}
