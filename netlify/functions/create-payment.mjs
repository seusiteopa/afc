// netlify/functions/create-payment.mjs
//
// Esta function é a "ponte" segura entre a página e o Mercado Pago.
// Ela é genérica: funciona pra QUALQUER produto, porque sempre busca
// o preço e o tipo certo no Supabase a partir do "product_slug" que
// a página manda — nunca confia no valor que vem do navegador.
//
// Nunca precisa editar este arquivo quando você criar um produto novo.
// (Aceita opcionalmente "address" e "customer_name" — usado só quando
// o produto é físico; pra digital, simplesmente vêm vazios.)

import { MercadoPagoConfig, Payment } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';
import { sendCustomerConfirmation, sendOwnerNotification } from './_shared/email.mjs';

const DIGITAL_BUCKET = 'digital-products';
const LINK_EXPIRES_SECONDS = 60 * 60 * 24 * 7; // o link de download dura 7 dias

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  try {
    const { product_slug, formData, address, customer_name } = JSON.parse(event.body || '{}');

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

    // 3) Grava o pedido no Supabase — inclui endereço só se vier preenchido (produto físico)
    await supabase.from('orders').insert({
      product_id: product.id,
      customer_email: formData?.payer?.email || null,
      customer_name: customer_name || null,
      status: orderStatus,
      mp_payment_id: String(result.id),
      amount_cents: product.price_cents,
      shipping_cep: address?.cep || null,
      shipping_street: address?.street || null,
      shipping_number: address?.number || null,
      shipping_complement: address?.complement || null,
      shipping_neighborhood: address?.neighborhood || null,
      shipping_city: address?.city || null,
      shipping_state: address?.state || null,
      shipping_phone: address?.phone || null,
    });

    // 4) Se aprovado JÁ na hora (comum em cartão), dispara os e-mails agora.
    // Pix/boleto normalmente ficam "pending" aqui e são confirmados depois
    // pelo mp-webhook.mjs, quando o Mercado Pago notificar a mudança de status.
    if (orderStatus === 'approved') {
      let downloadUrl = null;

      if (product.file_path) {
        const { data: signed } = await supabase.storage
          .from(DIGITAL_BUCKET)
          .createSignedUrl(product.file_path, LINK_EXPIRES_SECONDS);
        downloadUrl = signed?.signedUrl || null;
      }

      try {
        await sendCustomerConfirmation({
          toEmail: formData?.payer?.email,
          productName: product.name,
          downloadUrl,
        });

        await sendOwnerNotification({
          productName: product.name,
          amountCents: product.price_cents,
          customerEmail: formData?.payer?.email,
          customerName: customer_name,
          address,
        });

        await supabase
          .from('orders')
          .update({ delivered: true })
          .eq('mp_payment_id', String(result.id));
      } catch (emailErr) {
        // Não falha o pagamento por causa do e-mail — o cliente já pagou.
        console.error('Falha ao enviar e-mail de confirmação:', emailErr);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: mpStatus,
        payment_id: result.id,
        pix: result.point_of_interaction?.transaction_data
          ? {
              qr_code: result.point_of_interaction.transaction_data.qr_code,
              qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
            }
          : null,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao processar pagamento' }) };
  }
};
