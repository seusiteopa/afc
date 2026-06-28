// netlify/functions/mp-webhook.mjs
//
// O Mercado Pago chama esta URL automaticamente quando o status de um
// pagamento muda — é assim que Pix e boleto (que não confirmam na hora)
// conseguem disparar o e-mail de entrega depois, mesmo sem o cliente
// estar mais na página.
//
// Pra isso funcionar, ainda falta CONFIGURAR essa URL dentro do painel
// do Mercado Pago (Sua aplicação → Webhooks → adicionar URL):
//   https://SEUSITE.netlify.app/.netlify/functions/mp-webhook
// Selecionando o evento "Pagamentos".

import { MercadoPagoConfig, Payment } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';
import { sendCustomerConfirmation, sendOwnerNotification } from './_shared/email.mjs';

const DIGITAL_BUCKET = 'digital-products';
const LINK_EXPIRES_SECONDS = 60 * 60 * 24 * 7;

export const handler = async (event) => {
  // O Mercado Pago às vezes testa a URL com GET — só confirmamos recebimento.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'ok' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const paymentId = body?.data?.id || event.queryStringParameters?.['data.id'];

    if (!paymentId) {
      return { statusCode: 200, body: 'sem id' };
    }

    // 1) Pergunta pro Mercado Pago qual é o status REAL desse pagamento
    // (nunca confiamos só no que vem no corpo da notificação).
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);
    const result = await payment.get({ id: paymentId });

    const mpStatus = result.status;
    const orderStatus =
      mpStatus === 'approved' ? 'approved' : mpStatus === 'rejected' ? 'rejected' : 'pending';

    // 2) Acha o pedido correspondente no Supabase
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: order } = await supabase
      .from('orders')
      .select('*, products:product_id(*)')
      .eq('mp_payment_id', String(paymentId))
      .single();

    if (!order) {
      return { statusCode: 200, body: 'pedido nao encontrado' };
    }

    await supabase.from('orders').update({ status: orderStatus }).eq('id', order.id);

    // 3) Se ACABOU de ser aprovado (e ainda não entregamos), dispara os e-mails
    if (orderStatus === 'approved' && !order.delivered) {
      const product = order.products;
      let downloadUrl = null;

      if (product?.file_path) {
        const { data: signed } = await supabase.storage
          .from(DIGITAL_BUCKET)
          .createSignedUrl(product.file_path, LINK_EXPIRES_SECONDS);
        downloadUrl = signed?.signedUrl || null;
      }

      await sendCustomerConfirmation({
        toEmail: order.customer_email,
        productName: product?.name,
        downloadUrl,
      });

      await sendOwnerNotification({
        productName: product?.name,
        amountCents: order.amount_cents,
        customerEmail: order.customer_email,
        customerName: order.customer_name,
        address: {
          cep: order.shipping_cep,
          street: order.shipping_street,
          number: order.shipping_number,
          complement: order.shipping_complement,
          neighborhood: order.shipping_neighborhood,
          city: order.shipping_city,
          state: order.shipping_state,
          phone: order.shipping_phone,
        },
      });

      await supabase.from('orders').update({ delivered: true }).eq('id', order.id);
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error(err);
    // Sempre devolve 200 — se devolvermos erro, o Mercado Pago insiste
    // re-enviando a notificação várias vezes em loop.
    return { statusCode: 200, body: 'erro tratado' };
  }
};
