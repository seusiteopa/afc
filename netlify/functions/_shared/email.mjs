// netlify/functions/_shared/email.mjs
//
// Funções de e-mail compartilhadas entre create-payment.mjs e mp-webhook.mjs.
// Centralizar aqui evita duplicar a mesma lógica nos dois arquivos.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

async function sendEmail({ toEmail, subject, htmlContent }) {
  if (!toEmail) return;
  await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: process.env.SENDER_NAME, email: process.env.SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject,
      htmlContent,
    }),
  });
}

// E-mail pro CLIENTE, quando o pagamento é aprovado.
export async function sendCustomerConfirmation({ toEmail, productName, downloadUrl }) {
  const htmlContent = downloadUrl
    ? `<p>Olá!</p>
       <p>Seu pagamento de <strong>${productName}</strong> foi confirmado. Aqui está o link para baixar seu material:</p>
       <p><a href="${downloadUrl}">${downloadUrl}</a></p>
       <p>O link expira em 7 dias.</p>`
    : `<p>Olá!</p>
       <p>Seu pagamento de <strong>${productName}</strong> foi confirmado. Você vai receber o material em breve.</p>`;

  await sendEmail({ toEmail, subject: `Pedido confirmado — ${productName}`, htmlContent });
}

// E-mail pra VOCÊ (dono da loja), com os dados pra fazer o pedido no fornecedor
// quando o produto for físico.
export async function sendOwnerNotification({ productName, amountCents, customerEmail, customerName, address }) {
  const ownerEmail = process.env.SENDER_EMAIL;
  const valor = 'R$ ' + (amountCents / 100).toFixed(2).replace('.', ',');

  let addressBlock = '';
  if (address && address.cep) {
    addressBlock = `
      <p><strong>Endereço de entrega:</strong><br>
      ${address.street || ''}, ${address.number || ''} ${address.complement || ''}<br>
      ${address.neighborhood || ''} — ${address.city || ''}/${address.state || ''}<br>
      CEP: ${address.cep || ''}<br>
      Telefone: ${address.phone || ''}</p>
    `;
  }

  const htmlContent = `
    <p>Nova venda aprovada: <strong>${productName}</strong> (${valor})</p>
    <p>Cliente: ${customerName || '(sem nome informado)'}<br>E-mail: ${customerEmail || ''}</p>
    ${addressBlock}
  `;

  await sendEmail({ toEmail: ownerEmail, subject: `Nova venda — ${productName}`, htmlContent });
}
