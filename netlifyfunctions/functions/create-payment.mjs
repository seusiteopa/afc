// netlify/functions/create-payment.mjs
//
// Esta function é a "ponte" segura entre a página e o Mercado Pago.
// Ela é genérica: funciona pra QUALQUER produto, porque sempre busca
// o preço e o tipo certo no Supabase a partir do "product_slug" que
// a página manda — nunca confia no valor que vem do navegador.
//
// Nunca precisa editar este arquivo quando você criar um produto novo.

import { MercadoPagoConfig, Payment } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  try {
    const { product_slug, formData } = JSON.parse(event.body || '{}');

    if (!product_slug || !formData) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
    }

    // 1) Conecta no Supabase e busca o produto pelo slug
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('slug', product_slug)
      .eq('active', true)
      .single();

    if (productError || !product) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Produto não encontrado' }) };
    }

    // O preço de verdade é o do banco — ignoramos qualquer valor
    // que tenha vindo do navegador, por segurança.
    const realAmount = product.price_cents / 100;

    // 2) Cobra de verdade no Mercado Pago
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    const result = await payment.create({
      body: {
        ...formData,
        transaction_amount: realAmount,
        description: product.name,
      },
    });

    const mpStatus = result.status; // 'approved' | 'pending' | 'rejected' | etc.
    const orderStatus =
      mpStatus === 'approved' ? 'approved' : mpStatus === 'rejected' ? 'rejected' : 'pending';

    // 3) Grava o pedido no Supabase
    await supabase.from('orders').insert({
      product_id: product.id,
      customer_email: formData?.payer?.email || null,
      status: orderStatus,
      mp_payment_id: String(result.id),
      amount_cents: product.price_cents,
    });

    // (a Parte 4 vai entrar bem aqui: disparar o e-mail pelo Brevo
    // quando orderStatus === 'approved')

    return {
      statusCode: 200,
      body: JSON.stringify({ status: mpStatus, payment_id: result.id }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao processar pagamento' }) };
  }
};
