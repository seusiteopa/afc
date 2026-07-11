// netlify/functions/whatsapp-claude-webhook.mjs
//
// Webhook que conecta o WhatsApp Business API (Meta Cloud API) ao Claude.
// Fluxo: cliente manda mensagem no WhatsApp -> Meta chama esta função ->
// a função pergunta pro Claude -> a resposta é enviada de volta pelo WhatsApp.
//
// VARIÁVEIS DE AMBIENTE (Netlify > Site settings > Environment variables)
//   ANTHROPIC_API_KEY        -> chave da API do Claude (console.anthropic.com)
//   WHATSAPP_TOKEN           -> token de acesso do WhatsApp Cloud API (Meta for Developers)
//   WHATSAPP_PHONE_NUMBER_ID -> ID do número configurado no WhatsApp Business
//   WHATSAPP_VERIFY_TOKEN    -> senha inventada por você, usada na verificação do webhook

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const SYSTEM_PROMPT =
  "Você é um assistente de atendimento via WhatsApp. Responda em português, " +
  "de forma curta e direta (no máximo 3-4 frases), como se fosse um atendente humano simpático.";

// Histórico em memória por número (some a cada cold start).
// Pra produção real, trocar por um banco (Supabase, FaunaDB, Netlify Blobs, etc.)
const conversas = new Map();

export default async (req) => {
  const url = new URL(req.url);

  // 1) Verificação do webhook (Meta chama isso uma vez, via GET, ao configurar)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Token de verificação inválido", { status: 403 });
  }

  // 2) Mensagem recebida (POST)
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      // Ignora eventos que não são mensagem de texto (status de entrega, etc.)
      if (!msg || msg.type !== "text") {
        return new Response("ok", { status: 200 });
      }

      const from = msg.from; // número do cliente
      const texto = msg.text.body;

      const respostaClaude = await perguntarClaude(from, texto);
      await enviarWhatsApp(from, respostaClaude);

      return new Response("ok", { status: 200 });
    } catch (err) {
      console.error("Erro no webhook:", err);
      // Sempre devolve 200 pra Meta não ficar reenviando o mesmo evento
      return new Response("erro tratado", { status: 200 });
    }
  }

  return new Response("Método não permitido", { status: 405 });
};

async function perguntarClaude(numero, textoUsuario) {
  const historico = conversas.get(numero) || [];
  historico.push({ role: "user", content: textoUsuario });

  // mantém só as últimas 10 mensagens pra não estourar tokens
  const historicoLimitado = historico.slice(-10);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: historicoLimitado,
    }),
  });

  const data = await resp.json();
  const respostaTexto =
    data?.content?.[0]?.type === "text"
      ? data.content[0].text
      : "Desculpa, não consegui entender. Pode repetir?";

  historico.push({ role: "assistant", content: respostaTexto });
  conversas.set(numero, historico);

  return respostaTexto;
}

async function enviarWhatsApp(numeroDestino, texto) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numeroDestino,
      type: "text",
      text: { body: texto },
    }),
  });
}
