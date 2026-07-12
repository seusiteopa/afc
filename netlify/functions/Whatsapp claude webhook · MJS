// netlify/functions/whatsapp-claude-webhook.mjs
//
// Webhook que conecta o WhatsApp Business API (Meta Cloud API) ao Claude,
// com histórico de conversa persistido no Supabase (sobrevive a cold starts).
//
// Fluxo: cliente manda mensagem no WhatsApp -> Meta chama esta função ->
// a função busca o histórico no Supabase -> pergunta pro Claude ->
// salva a resposta no Supabase -> envia de volta pelo WhatsApp.
//
// VARIÁVEIS DE AMBIENTE (Netlify > Site settings > Environment variables)
//   ANTHROPIC_API_KEY        -> chave da API do Claude (console.anthropic.com)
//   WHATSAPP_TOKEN           -> token de acesso do WhatsApp Cloud API (Meta for Developers)
//   WHATSAPP_PHONE_NUMBER_ID -> ID do número configurado no WhatsApp Business
//   WHATSAPP_VERIFY_TOKEN    -> senha inventada por você, usada na verificação do webhook
//   SUPABASE_URL              -> URL do projeto (Supabase > Project Settings > API)
//   SUPABASE_SERVICE_KEY      -> service_role key (mesma tela, NÃO é a anon key)
//
// DEPENDÊNCIA (adicionar no package.json da pasta functions, ou rodar):
//   npm install @supabase/supabase-js --break-system-packages
//
// SETUP DO BANCO: rodar o arquivo schema-conversas.sql no SQL Editor do Supabase
// antes de usar esta function.

import { createClient } from "@supabase/supabase-js";
import { systemPromptCompleto } from "./prompts/fabricio-prompt.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

async function buscarHistorico(numero) {
  const { data, error } = await supabase
    .from("conversas")
    .select("historico")
    .eq("telefone", numero)
    .maybeSingle();

  if (error) {
    console.error("Erro ao buscar histórico:", error);
    return [];
  }

  return data?.historico || [];
}

async function salvarHistorico(numero, historico) {
  const { error } = await supabase
    .from("conversas")
    .upsert(
      { telefone: numero, historico, status: "em_conversa" },
      { onConflict: "telefone" }
    );

  if (error) {
    console.error("Erro ao salvar histórico:", error);
  }
}

async function perguntarClaude(numero, textoUsuario) {
  const historico = await buscarHistorico(numero);
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
      system: systemPromptCompleto,
      messages: historicoLimitado,
    }),
  });

  const data = await resp.json();
  const respostaTexto =
    data?.content?.[0]?.type === "text"
      ? data.content[0].text
      : "Desculpa, não consegui entender. Pode repetir?";

  historico.push({ role: "assistant", content: respostaTexto });

  // Salva o histórico completo (não só o limitado) pra não perder contexto antigo
  await salvarHistorico(numero, historico);

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
