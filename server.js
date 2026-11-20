import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  initDb,
  getAllLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  findDuplicateLead,
  recordProposalView,
  normalizeInstagram,
  normalizePhoneDigits,
  runInTransaction
} from './database.js';
import {
  parseCsvText,
  autoMapCsvHeaders,
  mapCsvRowsToLeads,
  findMatchingLead
} from './public/js/csv-core.js';

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const AGGREGATOR_DOMAINS = [
  'linktr.ee',
  'linktree',
  'wa.me',
  'api.whatsapp.com',
  'whatsapp.com',
  'bit.ly',
  'beacons.ai',
  'beacons',
  'bio.site',
  'lnk.bio',
  'ifood.com.br',
  'ifood',
  'anota.ai',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'campsite.bio',
  'taplink'
];

// Configurar Middlewares
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Banco de Dados
initDb();

// ----------------------------------------------------
// HELPERS DE TELEFONE, LINKS E EXTRAÇÃO POR IA
// ----------------------------------------------------
export function classifyBrPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return 'ausente';
  const trimmed = rawPhone.trim();
  if (!trimmed || trimmed.toLowerCase().includes('sem') || trimmed.toLowerCase().includes('indispon')) {
    return 'ausente';
  }

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return 'ausente';

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  if (/^[1-9]{2}9\d{8}$/.test(digits) || /^9\d{8}$/.test(digits)) {
    return 'celular';
  }

  if (/^[1-9]{2}[2-5]\d{7}$/.test(digits) || /^\d{8}$/.test(digits)) {
    return 'fixo';
  }

  return 'invalido';
}

function isAggregatorUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase().trim();
  return AGGREGATOR_DOMAINS.some(domain => lower.includes(domain));
}

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64Data: match[2]
  };
}

function parseJsonFromModelText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('A IA retornou uma resposta vazia.');
  }

  let cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Não foi possível interpretar o JSON retornado pela IA.');
  }
}

function buildPrintExtractionPrompt({ mode, defaultCity }) {
  const cityHint = defaultCity
    ? `Cidade/Região padrão configurada pelo usuário: "${defaultCity}". Se o print mostrar apenas o bairro ou estiver sem cidade explícita, você pode complementar o campo address com essa cidade/região, sem nunca inventar rua ou número.`
    : 'Se não houver cidade/endereço no print, deixe address vazio ou apenas com o bairro/cidade visível.';

  const modeHint = mode === 'merge_single'
    ? 'MODO CONSOLIDADO: Todas as imagens enviadas pertencem à MESMA empresa (ex.: topo da bio + destaques/feed + post ou Maps). Consolide tudo em exatamente 1 objeto dentro de "businesses".'
    : 'MODO INDIVIDUAL/LISTA: Se a imagem mostrar o perfil de 1 empresa (ex.: Instagram ou ficha do Maps), retorne 1 objeto. Se a imagem mostrar uma LISTA com várias empresas (ex.: resultados de busca do Maps/Google), extraia TODAS as empresas visíveis na lista.';

  return `Você é um especialista brasileiro em prospecção B2B local. Analise cuidadosamente o(s) print(s) enviado(s) — que podem ser do Instagram de uma loja/empresa, Google Maps, Busca do Google ou WhatsApp Business.

${modeHint}
${cityHint}

Retorne EXCLUSIVAMENTE um objeto JSON válido com a estrutura exata:
{
  "businesses": [
    {
      "name": "Nome comercial da empresa",
      "source": "instagram | google_maps | google_search | whatsapp | outro",
      "instagram": "@usuario (ou vazio)",
      "followers": "Ex: 4.520 seguidores (ou vazio se não visível)",
      "category": "Categoria/nicho em português (ex: Clínica de Estética, Oficina Mecânica, Barbearia, Pet Shop, Pizzaria, Loja de Roupas)",
      "phone": "Telefone/WhatsApp visível (extraia inclusive de links wa.me/55... na bio; vazio se não houver)",
      "address": "Endereço ou bairro/cidade visível (ou vazio)",
      "opening_hours": "Horário de funcionamento visível (ou vazio)",
      "rating": 0,
      "user_ratings_total": 0,
      "has_website": false,
      "website": "URL apenas se for site próprio real (ex: minhaloja.com.br); vazio se não tiver",
      "bio_link": "Link da bio caso seja Linktree, WhatsApp, Bitly, iFood, Anota.ai, etc.",
      "bio": "Resumo fiel da bio/descrição visível no perfil",
      "services": [
        { "title": "Serviço 1", "desc": "Descrição curta e realista baseada na bio/posts/nicho" },
        { "title": "Serviço 2", "desc": "Descrição curta e realista baseada na bio/posts/nicho" },
        { "title": "Serviço 3", "desc": "Descrição curta e realista baseada na bio/posts/nicho" }
      ],
      "reviews_sample": [
        { "author": "Nome", "text": "Comentário real visível no print", "rating": 5 }
      ],
      "brand_color": "#6366f1",
      "confidence": "alta | media | baixa",
      "notes_ai": "Observação rápida para o vendedor (ex: tem link na bio só para WhatsApp, ótimo potencial)"
    }
  ]
}

REGRAS OBRIGATÓRIAS:
1. NUNCA invente telefone, endereço, nota ou avaliações que não estejam visíveis no print.
2. Em prints do Instagram: se o link na bio for Linktree (linktr.ee), wa.me, api.whatsapp.com, bit.ly, beacons, bio.site, iFood, Anota.ai, ou outro perfil social, defina "has_website": false, coloque esse link em "bio_link" e deixe "website" vazio.
3. Extraia "services" (sempre 3 itens curtos e atrativos) a partir dos serviços, produtos ou diferenciais mencionados na bio, destaques e legendas/fotos visíveis.
4. "reviews_sample" deve ser um array vazio [] se não houver avaliações de clientes legíveis no print.
5. "brand_color" deve ser um código hex vibrante (#RRGGBB) inspirado na cor predominante da logo/foto/identidade visual da empresa no print.
6. "rating" deve ser número (ex: 4.8 ou 0) e "user_ratings_total" deve ser inteiro (ex: 120 ou 0).`;
}

const DEFAULT_GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];

async function callGeminiVision({ apiKey, model, prompt, parsedImages }) {
  const envModel = (process.env.GEMINI_MODEL || '').trim();
  const candidates = Array.from(
    new Set(
      [model, envModel, ...DEFAULT_GEMINI_MODELS]
        .filter(Boolean)
        .map(m => String(m).trim().replace(/^models\//i, ''))
        .filter(Boolean)
    )
  );

  const imageParts = parsedImages.map(img => ({
    inline_data: {
      mime_type: img.mimeType,
      data: img.base64Data
    }
  }));

  let lastError = null;

  for (const candidateModel of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }, ...imageParts]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        }),
        signal: AbortSignal.timeout(25000)
      });
    } catch (err) {
      lastError = new Error(`Modelo Gemini "${candidateModel}" falhou (${err.message})`);
      console.warn(`[Gemini Vision] Modelo "${candidateModel}" indisponível (${err.message}), tentando fallback...`);
      continue;
    }

    if (response.status === 404 || response.status === 429 || response.status === 503) {
      const errText = await response.text();
      lastError = new Error(`Modelo Gemini "${candidateModel}" indisponível (${response.status}): ${errText}`);
      console.warn(`[Gemini Vision] Modelo "${candidateModel}" indisponível (${response.status}), tentando fallback...`);
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API erro (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const answerParts = parts.filter(p => !p.thought && typeof p.text === 'string');
    const rawText = (answerParts.length > 0 ? answerParts : parts)
      .map(p => p.text || '')
      .join('\n');
    return {
      parsed: parseJsonFromModelText(rawText),
      usedModel: candidateModel
    };
  }

  throw lastError || new Error('Nenhum modelo Gemini disponível respondeu com sucesso.');
}

async function callOpenAiVision({ apiKey, model, prompt, dataUrls }) {
  const targetModel = model || 'gpt-4o-mini';
  const contentParts = [
    { type: 'text', text: prompt },
    ...dataUrls.map(url => ({
      type: 'image_url',
      image_url: { url }
    }))
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: targetModel,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: contentParts
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API erro (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data?.choices?.[0]?.message?.content || '';
  return {
    parsed: parseJsonFromModelText(rawText),
    usedModel: targetModel
  };
}

function stableSlugHash(text) {
  const clean = (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  let hash = 5381;
  for (let i = 0; i < (text || '').length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return `${clean || 'empresa'}_${(hash >>> 0).toString(36)}`;
}

function postProcessExtractedBusiness(rawBiz, fallbackIndex = 0) {
  const biz = rawBiz && typeof rawBiz === 'object' ? rawBiz : {};
  const name = typeof biz.name === 'string' && biz.name.trim() ? biz.name.trim() : `Empresa ${fallbackIndex + 1}`;
  const instagram = normalizeInstagram(biz.instagram || '');

  let website = typeof biz.website === 'string' ? biz.website.trim() : '';
  let bioLink = typeof biz.bio_link === 'string' ? biz.bio_link.trim() : '';
  let hasWebsite = Boolean(biz.has_website && website);

  if (website && isAggregatorUrl(website)) {
    if (!bioLink) bioLink = website;
    website = '';
    hasWebsite = false;
  }

  if (bioLink && !website) {
    hasWebsite = false;
  }

  const rawColor = typeof biz.brand_color === 'string' ? biz.brand_color.trim() : '';
  const brandColor = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '';

  const parsedRating = parseFloat(biz.rating);
  const rating = Number.isFinite(parsedRating) ? Math.min(5, Math.max(0, parsedRating)) : 0;

  const parsedReviewsCount = parseInt(biz.user_ratings_total, 10);
  const userRatingsTotal = Number.isFinite(parsedReviewsCount) && parsedReviewsCount > 0 ? parsedReviewsCount : 0;

  const services = Array.isArray(biz.services)
    ? biz.services
        .filter(s => s && (s.title || s.desc))
        .slice(0, 4)
        .map(s => ({
          title: String(s.title || 'Serviço').trim().slice(0, 60),
          desc: String(s.desc || '').trim().slice(0, 140)
        }))
    : [];

  const reviewsSample = Array.isArray(biz.reviews_sample)
    ? biz.reviews_sample
        .filter(r => r && r.text)
        .slice(0, 3)
        .map(r => ({
          author: String(r.author || 'Cliente').trim().slice(0, 40),
          text: String(r.text || '').trim().slice(0, 220),
          rating: Math.min(5, Math.max(1, parseInt(r.rating, 10) || 5))
        }))
    : [];

  const phone = typeof biz.phone === 'string' ? biz.phone.trim() : '';
  const phoneType = classifyBrPhone(phone);

  const validSources = ['instagram', 'google_maps', 'google_search', 'whatsapp', 'print', 'outro'];
  let source = typeof biz.source === 'string' ? biz.source.trim().toLowerCase() : 'print';
  if (!validSources.includes(source)) source = instagram ? 'instagram' : 'print';
  if (instagram && source === 'outro') source = 'instagram';

  const cleanPhoneDigits = normalizePhoneDigits(phone);
  let placeId = '';
  if (instagram) {
    placeId = `print_ig_${instagram.replace(/^@/, '').replace(/[^a-z0-9_.-]/g, '')}`;
  } else if (cleanPhoneDigits) {
    placeId = `print_${stableSlugHash(name)}_${cleanPhoneDigits}`;
  } else {
    placeId = `print_${stableSlugHash(`${name}|${biz.address || ''}`)}`;
  }

  const normalizedBiz = {
    place_id: placeId,
    name,
    source,
    instagram,
    followers: typeof biz.followers === 'string' ? biz.followers.trim() : '',
    category: typeof biz.category === 'string' && biz.category.trim() ? biz.category.trim() : 'Negócio Local',
    phone,
    phone_type: phoneType,
    address: typeof biz.address === 'string' ? biz.address.trim() : '',
    opening_hours: typeof biz.opening_hours === 'string' ? biz.opening_hours.trim() : '',
    rating,
    user_ratings_total: userRatingsTotal,
    has_website: hasWebsite,
    website,
    bio_link: bioLink,
    bio: typeof biz.bio === 'string' ? biz.bio.trim() : '',
    services,
    reviews_sample: reviewsSample,
    brand_color: brandColor,
    confidence: ['alta', 'media', 'baixa'].includes(biz.confidence) ? biz.confidence : 'media',
    notes_ai: typeof biz.notes_ai === 'string' ? biz.notes_ai.trim() : ''
  };

  const dup = findDuplicateLead(normalizedBiz);
  normalizedBiz.already_in_crm = Boolean(dup);
  normalizedBiz.existing_lead_id = dup ? dup.id : null;

  return normalizedBiz;
}

// ----------------------------------------------------
// ROTAS DE SAÚDE E AUTENTICAÇÃO
// ----------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    hasEnvGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasEnvOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    hasEnvPlacesKey: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    defaultGeminiModel: (process.env.GEMINI_MODEL || 'gemini-flash-latest').trim()
  });
});

app.post('/api/auth/login', (req, res) => {
  const expectedPassword = process.env.APP_PASSWORD || 'fortal123';
  const provided = req.body?.password || '';

  if (provided === expectedPassword) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
});

// ----------------------------------------------------
// ROTAS DO BANCO DE DADOS (CRM LEADS)
// ----------------------------------------------------

// Listar todos os leads no CRM
app.get('/api/leads', (req, res) => {
  try {
    const leads = getAllLeads();
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar leads no banco de dados', details: error.message });
  }
});

// Obter lead específico
app.get('/api/leads/:id', (req, res) => {
  try {
    const lead = getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado' });
    }
    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar lead', details: error.message });
  }
});

// Adicionar um lead ao CRM
app.post('/api/leads', (req, res) => {
  try {
    if (!req.body || !req.body.name || !String(req.body.name).trim()) {
      return res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
    }

    const result = createLead(req.body);
    const { _duplicate, ...lead } = result;
    if (_duplicate) {
      return res.status(200).json({ ...lead, duplicate: true });
    }
    res.status(201).json({ ...lead, duplicate: false });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar lead', details: error.message });
  }
});

// Importar leads em lote
app.post('/api/leads/bulk', (req, res) => {
  try {
    const leadsInput = req.body?.leads;
    if (!Array.isArray(leadsInput)) {
      return res.status(400).json({ error: 'Campo "leads" deve ser um array.' });
    }

    const imported = [];
    const skipped = [];

    runInTransaction(() => {
      for (const item of leadsInput) {
        if (!item || !item.name || !String(item.name).trim()) {
          skipped.push({ item, reason: 'invalid_name' });
          continue;
        }

        try {
          const result = createLead(item);
          const { _duplicate, ...lead } = result;
          if (_duplicate) {
            skipped.push({ name: lead.name, existingId: lead.id, reason: 'duplicate' });
          } else {
            imported.push(lead);
          }
        } catch (err) {
          skipped.push({ name: item.name, reason: err.message });
        }
      }
    });

    res.json({ imported, skipped });
  } catch (error) {
    res.status(500).json({ error: 'Erro na importação em lote', details: error.message });
  }
});

// Importar leads a partir de texto CSV (suporta dryRun para prévia/validação)
app.post('/api/leads/import-csv', (req, res) => {
  try {
    const {
      csvText,
      filename = 'importacao.csv',
      delimiter = null,
      mapping = null,
      dryRun = false,
      skipWithWebsite = true,
      onlyWithContact = false,
      defaultStatus = 'novo'
    } = req.body || {};

    if (!csvText || typeof csvText !== 'string' || !csvText.trim()) {
      return res.status(400).json({ error: 'Conteúdo CSV ("csvText") é obrigatório.' });
    }

    const parsed = parseCsvText(csvText, delimiter || null);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      return res.status(400).json({ error: 'CSV vazio ou sem linhas de dados.' });
    }

    const resolvedMapping =
      mapping && typeof mapping === 'object' ? mapping : autoMapCsvHeaders(parsed.headers);

    if (
      resolvedMapping.name === undefined ||
      resolvedMapping.name === null ||
      Number(resolvedMapping.name) < 0
    ) {
      return res.status(400).json({
        error: 'Coluna de nome da empresa não identificada no CSV.',
        headers: parsed.headers,
        mapping: resolvedMapping
      });
    }

    const mapped = mapCsvRowsToLeads(parsed.headers, parsed.rows, resolvedMapping, {
      filename,
      defaultStatus
    });

    const eligibleItems = [];
    const skipped = [];
    let invalidCount = 0;
    let filteredWebsiteCount = 0;
    let filteredNoContactCount = 0;
    let duplicateCount = 0;

    for (const item of mapped) {
      if (!item.valid) {
        invalidCount++;
        skipped.push({ rowNumber: item._rowNumber, name: item.name || '', reason: 'invalid_name' });
        continue;
      }

      if (skipWithWebsite && item.has_website) {
        filteredWebsiteCount++;
        skipped.push({ rowNumber: item._rowNumber, name: item.name, reason: 'has_website' });
        continue;
      }

      const phoneType = classifyBrPhone(item.phone);
      const hasContact =
        Boolean(item.instagram) || phoneType === 'celular' || phoneType === 'fixo';
      if (onlyWithContact && !hasContact) {
        filteredNoContactCount++;
        skipped.push({ rowNumber: item._rowNumber, name: item.name, reason: 'no_contact' });
        continue;
      }

      const existing = findDuplicateLead(item);
      if (existing) {
        duplicateCount++;
        skipped.push({
          rowNumber: item._rowNumber,
          name: item.name,
          existingId: existing.id,
          reason: 'duplicate'
        });
        continue;
      }

      if (dryRun && findMatchingLead(item, eligibleItems)) {
        duplicateCount++;
        skipped.push({ rowNumber: item._rowNumber, name: item.name, reason: 'duplicate_in_csv' });
        continue;
      }

      eligibleItems.push(item);
    }

    if (dryRun) {
      return res.json({
        dryRun: true,
        delimiter: parsed.delimiter,
        headers: parsed.headers,
        mapping: resolvedMapping,
        summary: {
          totalRows: mapped.length,
          eligible: eligibleItems.length,
          duplicates: duplicateCount,
          withWebsite: filteredWebsiteCount,
          withoutContact: filteredNoContactCount,
          invalid: invalidCount
        },
        preview: mapped.slice(0, 50)
      });
    }

    const imported = [];
    runInTransaction(() => {
      for (const item of eligibleItems) {
        const result = createLead(item);
        const { _duplicate, ...lead } = result;
        if (_duplicate) {
          duplicateCount++;
          skipped.push({
            rowNumber: item._rowNumber,
            name: lead.name,
            existingId: lead.id,
            reason: 'duplicate'
          });
        } else {
          imported.push(lead);
        }
      }
    });

    res.json({
      dryRun: false,
      delimiter: parsed.delimiter,
      mapping: resolvedMapping,
      imported,
      skipped,
      summary: {
        totalRows: mapped.length,
        importedCount: imported.length,
        duplicateCount,
        filteredWebsiteCount,
        filteredNoContactCount,
        invalidCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao importar CSV', details: error.message });
  }
});

// Atualizar status ou notas de um lead
app.put('/api/leads/:id', (req, res) => {
  try {
    const updatedLead = updateLead(req.params.id, req.body);
    if (!updatedLead) {
      return res.status(404).json({ error: 'Lead não encontrado para atualização' });
    }
    res.json(updatedLead);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar lead', details: error.message });
  }
});

// Deletar um lead do CRM
app.delete('/api/leads/:id', (req, res) => {
  try {
    const success = deleteLead(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Lead não encontrado para exclusão' });
    }
    res.json({ message: 'Lead removido com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover lead', details: error.message });
  }
});

// ----------------------------------------------------
// ROTAS DE PROPOSTA
// ----------------------------------------------------

// Obter dados dinâmicos da proposta de um lead específico
app.get('/api/proposal-data/:id', (req, res) => {
  try {
    const lead = getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado para gerar proposta' });
    }
    res.json({
      lead,
      whatsappContact: process.env.YOUR_WHATSAPP || '5511999999999',
      sellerName: process.env.SELLER_NAME || 'Agência Web Profissional'
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao obter proposta', details: error.message });
  }
});

// Registrar visualização da proposta pelo cliente (sem sobrescrever anotações)
app.post('/api/proposal-view/:id', (req, res) => {
  try {
    const updatedLead = recordProposalView(req.params.id);
    if (!updatedLead) {
      return res.status(404).json({ error: 'Lead não encontrado para registrar visualização' });
    }
    res.json({ ok: true, lead: updatedLead });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar visualização', details: error.message });
  }
});

// ----------------------------------------------------
// ROTA DE EXTRAÇÃO DE PRINTS POR IA (VISÃO)
// ----------------------------------------------------
app.post('/api/extract-from-print', async (req, res) => {
  try {
    const {
      images,
      mode = 'separate',
      provider = 'gemini',
      apiKey,
      model,
      defaultCity = ''
    } = req.body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Envie ao menos 1 imagem para análise.' });
    }

    if (images.length > 15) {
      return res.status(400).json({ error: 'Máximo de 15 imagens por lote.' });
    }

    const normalizedProvider = provider === 'openai' ? 'openai' : 'gemini';
    const resolvedKey = String(
      apiKey ||
      req.headers['x-ai-api-key'] ||
      (normalizedProvider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY) ||
      ''
    ).trim();

    if (!resolvedKey) {
      return res.status(400).json({
        error: 'Chave de API da IA não configurada.',
        code: 'MISSING_AI_KEY'
      });
    }

    const prompt = buildPrintExtractionPrompt({ mode, defaultCity });
    const parsedEntries = images.map((img, index) => ({
      index,
      filename: img?.filename || `print-${index + 1}.jpg`,
      dataUrl: img?.dataUrl || '',
      parsed: parseDataUrl(img?.dataUrl)
    }));

    const validEntries = parsedEntries.filter(entry => entry.parsed !== null);
    const errors = parsedEntries
      .filter(entry => entry.parsed === null)
      .map(entry => ({
        filename: entry.filename,
        error: 'Formato de imagem inválido (esperado Data URL base64).'
      }));

    if (validEntries.length === 0) {
      return res.status(400).json({
        error: 'Nenhuma imagem válida encontrada para análise.',
        errors
      });
    }

    const rawBusinesses = [];
    const usedModels = new Set();

    if (mode === 'merge_single') {
      try {
        const result =
          normalizedProvider === 'openai'
            ? await callOpenAiVision({
                apiKey: resolvedKey,
                model,
                prompt,
                dataUrls: validEntries.map(e => e.dataUrl)
              })
            : await callGeminiVision({
                apiKey: resolvedKey,
                model,
                prompt,
                parsedImages: validEntries.map(e => e.parsed)
              });

        if (result.usedModel) usedModels.add(result.usedModel);
        const list = Array.isArray(result.parsed?.businesses) ? result.parsed.businesses : [];
        rawBusinesses.push(...list);
      } catch (err) {
        errors.push({
          filename: validEntries.map(e => e.filename).join(', '),
          error: err.message
        });
      }
    } else {
      // Concorrência controlada de 2 em 2 para equilibrar velocidade e rate limit
      const concurrency = 2;
      for (let i = 0; i < validEntries.length; i += concurrency) {
        const batch = validEntries.slice(i, i + concurrency);
        const batchOutcomes = await Promise.all(
          batch.map(async entry => {
            try {
              const result =
                normalizedProvider === 'openai'
                  ? await callOpenAiVision({
                      apiKey: resolvedKey,
                      model,
                      prompt,
                      dataUrls: [entry.dataUrl]
                    })
                  : await callGeminiVision({
                      apiKey: resolvedKey,
                      model,
                      prompt,
                      parsedImages: [entry.parsed]
                    });

              const list = Array.isArray(result.parsed?.businesses) ? result.parsed.businesses : [];
              return { ok: true, filename: entry.filename, businesses: list, usedModel: result.usedModel };
            } catch (err) {
              return { ok: false, filename: entry.filename, error: err.message };
            }
          })
        );

        for (const outcome of batchOutcomes) {
          if (outcome.ok) {
            if (outcome.usedModel) usedModels.add(outcome.usedModel);
            rawBusinesses.push(...outcome.businesses);
          } else {
            errors.push({ filename: outcome.filename, error: outcome.error });
          }
        }
      }
    }

    const businesses = rawBusinesses.map((biz, idx) => postProcessExtractedBusiness(biz, idx));

    res.json({
      businesses,
      processedImages: validEntries.length,
      usedModels: Array.from(usedModels),
      errors
    });
  } catch (error) {
    console.error('[Print Extract] Erro inesperado:', error);
    res.status(500).json({
      error: 'Erro interno ao processar prints.',
      details: error.message
    });
  }
});

// ----------------------------------------------------
// BUSCA GRATUITA REAL VIA OPENSTREETMAP (NOMINATIM)
// ----------------------------------------------------
const osmSearchCache = new Map();
const OSM_CACHE_TTL_MS = 10 * 60 * 1000;

const OSM_ALLOWED_CLASSES = new Set(['shop', 'craft', 'healthcare', 'office', 'leisure']);
const OSM_ALLOWED_AMENITIES = new Set([
  'restaurant',
  'cafe',
  'fast_food',
  'bar',
  'pub',
  'ice_cream',
  'dentist',
  'clinic',
  'doctors',
  'veterinary',
  'pharmacy',
  'car_wash',
  'beauty_salon',
  'hairdresser',
  'spa',
  'gym',
  'studio',
  'training',
  'animal_boarding'
]);
const OSM_EXCLUDED_TYPES = new Set([
  'fuel',
  'bank',
  'atm',
  'school',
  'college',
  'university',
  'place_of_worship',
  'hospital',
  'police',
  'courthouse',
  'prison',
  'parking',
  'bus_station',
  'toilets',
  'fountain',
  'bench',
  'grave_yard',
  'post_office',
  'townhall',
  'community_centre'
]);

const OSM_TYPE_LABELS = {
  clothes: 'Loja de Roupas',
  car_repair: 'Oficina Mecânica',
  hairdresser: 'Salão / Barbearia',
  beauty: 'Estética / Beleza',
  beauty_salon: 'Salão de Beleza',
  dentist: 'Clínica Odontológica',
  clinic: 'Clínica',
  doctors: 'Consultório Médico',
  veterinary: 'Clínica Veterinária',
  pet: 'Pet Shop',
  bakery: 'Padaria',
  restaurant: 'Restaurante',
  fast_food: 'Lanchonete / Pizzaria',
  cafe: 'Cafeteria',
  bar: 'Bar',
  pub: 'Pub / Bar',
  ice_cream: 'Sorveteria',
  fitness_centre: 'Academia',
  gym: 'Academia',
  optician: 'Ótica',
  electronics: 'Eletrônicos',
  furniture: 'Móveis',
  hardware: 'Materiais / Ferragens',
  florist: 'Floricultura',
  jewelry: 'Joalheria / Acessórios',
  shoes: 'Calçados',
  cosmetics: 'Cosméticos',
  pharmacy: 'Farmácia',
  supermarket: 'Supermercado',
  convenience: 'Mercadinho / Conveniência',
  butcher: 'Açougue',
  car_parts: 'Autopeças',
  bicycle: 'Bicicletaria',
  mobile_phone: 'Celulares & Assistência',
  computer: 'Informática',
  gift: 'Presentes',
  sports: 'Artigos Esportivos',
  tailor: 'Costura / Alfaiataria'
};

function formatOsmAddress(addr = {}, displayName = '') {
  const street = addr.road || addr.pedestrian || '';
  const num = addr.house_number || '';
  const streetLine = [street, num].filter(Boolean).join(', ');
  const suburb = addr.suburb || addr.neighbourhood || addr.city_district || '';
  const city = addr.city || addr.town || 'Fortaleza';
  const state = addr.state === 'Ceará' ? 'CE' : addr.state || 'CE';

  const parts = [streetLine, suburb, `${city} - ${state}`].filter(Boolean);
  if (parts.length > 0) return parts.join(' • ');
  return displayName ? displayName.split(',').slice(0, 3).join(',').trim() : 'Fortaleza - CE';
}

function buildSearchLinks(name, address, instagram) {
  const mapsQuery = [name, address || 'Fortaleza CE'].filter(Boolean).join(' ');
  const google_maps_uri = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;
  const cleanIg = normalizeInstagram(instagram);
  const instagram_search_url = cleanIg
    ? `https://www.instagram.com/${cleanIg.replace(/^@/, '')}/`
    : `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com "${name}" Fortaleza`)}`;
  return { google_maps_uri, instagram_search_url };
}

async function searchOpenStreetMapNominatim(query, { restrictFortaleza = false } = {}) {
  const cacheKey = `${query.trim().toLowerCase()}|${Boolean(restrictFortaleza)}`;
  const cached = osmSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OSM_CACHE_TTL_MS) {
    return cached.results;
  }

  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    extratags: '1',
    addressdetails: '1',
    limit: '40',
    countrycodes: 'br'
  });

  if (restrictFortaleza || query.toLowerCase().includes('fortaleza')) {
    params.set('viewbox', '-38.64,-3.69,-38.40,-3.89');
    params.set('bounded', '1');
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MapsLeadAnalyzer/1.0 (fortaleza-crm)',
      'Accept-Language': 'pt-BR'
    }
  });

  if (!response.ok) {
    throw new Error(`OpenStreetMap Nominatim retornou status ${response.status}`);
  }

  const items = await response.json();
  const results = [];

  for (const item of Array.isArray(items) ? items : []) {
    const name = (item.name || '').trim();
    if (!name) continue;

    const itemClass = (item.class || item.category || '').toLowerCase();
    const itemType = (item.type || '').toLowerCase();
    if (OSM_EXCLUDED_TYPES.has(itemType)) continue;

    const classAllowed =
      OSM_ALLOWED_CLASSES.has(itemClass) ||
      (itemClass === 'amenity' && OSM_ALLOWED_AMENITIES.has(itemType));
    if (!classAllowed) continue;

    const ex = item.extratags || {};
    let rawWebsite = (ex.website || ex['contact:website'] || '').trim();
    let rawInstagram = (ex['contact:instagram'] || ex.instagram || '').trim();
    let bioLink = '';
    let website = rawWebsite || null;
    let hasWebsite = Boolean(rawWebsite);

    if (rawWebsite && isAggregatorUrl(rawWebsite)) {
      if (rawWebsite.toLowerCase().includes('instagram.com') && !rawInstagram) {
        rawInstagram = rawWebsite;
      }
      bioLink = rawWebsite;
      website = null;
      hasWebsite = false;
    }

    const instagram = normalizeInstagram(rawInstagram);
    const phone = (ex['contact:whatsapp'] || ex.phone || ex['contact:phone'] || '').trim();
    const phoneType = classifyBrPhone(phone);
    const openingHours = (ex.opening_hours || '').trim();
    const address = formatOsmAddress(item.address, item.display_name);
    const category = OSM_TYPE_LABELS[itemType] || (itemType && itemType !== 'yes' ? itemType.replace(/_/g, ' ') : 'Comércio Local');
    const { google_maps_uri, instagram_search_url } = buildSearchLinks(name, address, instagram);

    results.push({
      place_id: `osm_${item.osm_type || 'node'}_${item.osm_id}`,
      name,
      phone: phone || 'Sem telefone',
      phone_type: phoneType,
      instagram,
      bio_link: bioLink,
      address,
      rating: 0,
      user_ratings_total: 0,
      category,
      latitude: item.lat ? parseFloat(item.lat) : null,
      longitude: item.lon ? parseFloat(item.lon) : null,
      website,
      has_website: hasWebsite,
      opening_hours: openingHours,
      google_maps_uri,
      instagram_search_url,
      source: 'openstreetmap'
    });
  }

  // Sem site primeiro; dentro deles, priorizar quem tem telefone ou Instagram
  results.sort((a, b) => {
    const siteDiff = (a.has_website ? 1 : 0) - (b.has_website ? 1 : 0);
    if (siteDiff !== 0) return siteDiff;
    const contactA = a.instagram || a.phone_type === 'celular' || a.phone_type === 'fixo' ? 0 : 1;
    const contactB = b.instagram || b.phone_type === 'celular' || b.phone_type === 'fixo' ? 0 : 1;
    return contactA - contactB;
  });

  osmSearchCache.set(cacheKey, { ts: Date.now(), results });
  return results;
}

// ----------------------------------------------------
// ROTA DE BUSCA (OPENSTREETMAP GRÁTIS / GOOGLE PLACES / SIMULADOR)
// ----------------------------------------------------
app.get('/api/search', async (req, res) => {
  const query = (req.query.query || '').trim();
  const rawMode = (req.query.mode || (req.query.simulate === 'true' ? 'simulation' : '')).toLowerCase();
  const restrictFortaleza = req.query.city === 'fortaleza';
  const apiKey = req.headers['x-google-api-key'] || process.env.GOOGLE_PLACES_API_KEY;

  if (!query) {
    return res.status(400).json({ error: 'Parâmetro de consulta "query" é obrigatório.' });
  }

  const effectiveMode = rawMode || (apiKey ? 'google' : 'osm');
  console.log(`[Search] Busca solicitada: "${query}" (Modo: ${effectiveMode}, Fortaleza: ${restrictFortaleza})`);

  if (effectiveMode === 'simulation') {
    const mockResults = generateMockPlaces(query);
    return res.json({ source: 'simulation', results: mockResults });
  }

  if (effectiveMode === 'osm') {
    try {
      const osmResults = await searchOpenStreetMapNominatim(query, { restrictFortaleza });
      return res.json({ source: 'openstreetmap', results: osmResults });
    } catch (error) {
      console.error('[Search OSM] Erro ao consultar OpenStreetMap:', error);
      return res.status(502).json({
        error: 'Erro ao consultar dados gratuitos do OpenStreetMap. Tente novamente em instantes.',
        details: error.message
      });
    }
  }

  if (effectiveMode === 'google' && !apiKey) {
    return res.status(400).json({
      error: 'Configure sua Google Places API Key nas Configurações ou use a fonte Grátis (OpenStreetMap).',
      code: 'MISSING_GOOGLE_KEY'
    });
  }

  try {
    // Nova API do Google Places (Text Search)
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.primaryType,places.location,places.businessStatus,places.regularOpeningHours,places.googleMapsUri'
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: 'pt-BR'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Places API retornou status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const places = (data.places || []).filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY');

    // Mapear dados para nosso formato padrão e analisar quais não têm site
    const processedResults = places.map(place => {
      const hasWebsite = !!place.websiteUri;
      const openingHours =
        place.regularOpeningHours?.weekdayDescriptions?.slice(0, 2).join(' | ') || '';
      const name = place.displayName?.text || 'Sem Nome';
      const phone = place.nationalPhoneNumber || 'Sem telefone';
      const address = place.formattedAddress || 'Sem endereço';
      const { google_maps_uri, instagram_search_url } = buildSearchLinks(name, address, '');

      return {
        place_id: place.id,
        name,
        phone,
        phone_type: classifyBrPhone(phone),
        address,
        rating: place.rating || 0,
        user_ratings_total: place.userRatingCount || 0,
        category: place.primaryType || 'Negócio Local',
        latitude: place.location?.latitude || null,
        longitude: place.location?.longitude || null,
        website: place.websiteUri || null,
        has_website: hasWebsite,
        opening_hours: openingHours,
        google_maps_uri: place.googleMapsUri || google_maps_uri,
        instagram_search_url,
        source: 'google_maps'
      };
    });

    res.json({ source: 'google_places_api', results: processedResults });
  } catch (error) {
    console.error('[Search] Erro ao pesquisar no Google Places:', error);
    res.status(500).json({
      error: 'Erro ao consultar API do Google Places. Tente usar a fonte Grátis (OpenStreetMap).',
      details: error.message
    });
  }
});

// Enviar mensagem automática via WhatsApp Cloud API Oficial (Meta)
app.post('/api/send-whatsapp-api', async (req, res) => {
  const {
    to,
    type,
    templateName,
    languageCode,
    variables,
    textBody,
    apiKey,
    phoneNumberId
  } = req.body;

  const token = apiKey || process.env.WHATSAPP_TOKEN;
  const phoneId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  console.log(`[WhatsApp API] Tentativa de envio para: ${to}. Tipo: ${type || 'template'}`);

  if (!token || !phoneId) {
    return res.status(400).json({
      error: 'Configurações do WhatsApp incompletas. Certifique-se de preencher o Token e o ID do telefone.'
    });
  }

  if (!to) {
    return res.status(400).json({ error: 'Número do destinatário "to" é obrigatório.' });
  }

  try {
    let requestBody = {
      messaging_product: 'whatsapp',
      to: to
    };

    if (type === 'text') {
      requestBody.type = 'text';
      requestBody.text = { body: textBody };
    } else {
      // Padrão: template
      requestBody.type = 'template';
      requestBody.template = {
        name: templateName || process.env.WHATSAPP_TEMPLATE_NAME || 'hello_world',
        language: {
          code: languageCode || 'pt_BR'
        }
      };

      if (variables && variables.length > 0) {
        requestBody.template.components = [
          {
            type: 'body',
            parameters: variables.map(v => ({
              type: 'text',
              text: v
            }))
          }
        ];
      }
    }

    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

    const response = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error('[WhatsApp API] Meta retornou erro:', responseData);
      return res.status(response.status).json({
        error: 'Erro retornado pela API da Meta',
        details: responseData.error || responseData
      });
    }

    console.log('[WhatsApp API] Mensagem enviada com sucesso:', responseData);
    res.json({ success: true, response: responseData });
  } catch (error) {
    console.error('[WhatsApp API] Erro ao enviar mensagem:', error);
    res.status(500).json({
      error: 'Erro interno ao tentar disparar mensagem via WhatsApp Cloud API',
      details: error.message
    });
  }
});

// ----------------------------------------------------
// GERADOR DE DADOS SIMULADOS (MOCK)
// ----------------------------------------------------
function generateMockPlaces(query) {
  const queryLower = query.toLowerCase();

  // Extrair localidade da query (ex: "em Santo André", "em São Paulo", "em Salvador")
  let location = 'Sua Região';
  const locMatch = queryLower.match(/(?:em|no|na|de)\s+([a-zA-Záàâãéèêíïóôõöúçñ\s]+)/i);
  if (locMatch && locMatch[1]) {
    location = locMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());
  }

  // Identificar tipo de negócio
  let categoryName = 'Negócio Local';
  let categoryKey = 'local';
  let businessNames = [];

  if (queryLower.includes('mecanic') || queryLower.includes('oficina') || queryLower.includes('auto')) {
    categoryName = 'Oficina Mecânica';
    categoryKey = 'mecanica';
    businessNames = [
      'Mecânica e Auto Center Silva',
      'Oficina do Juninho',
      'Auto Elétrica e Mecânica Central',
      'ABC Diagnóstico Automotivo',
      'Mecânica Rápida Precision',
      'Stop Car Reparadora',
      'Oficina Mecânica Speed',
      'MotorTech Auto Serviços'
    ];
  } else if (queryLower.includes('dentis') || queryLower.includes('odont') || queryLower.includes('clinic')) {
    categoryName = 'Clínica Odontológica';
    categoryKey = 'dentista';
    businessNames = [
      'Sorria Mais Odontologia',
      'Consultório Dentário Dr. Carlos',
      'Clínica Dental clean',
      'OrtoClin Odontologia Integrada',
      'Odonto Excellence',
      'Implantes e Estética Bucal',
      'Dra. Mariana Odontopediatria',
      'Belo Sorriso Implantes'
    ];
  } else if (queryLower.includes('restauran') || queryLower.includes('pizzar') || queryLower.includes('padar') || queryLower.includes('lanche')) {
    categoryName = 'Restaurante / Lanchonete';
    categoryKey = 'restaurante';
    businessNames = [
      'Restaurante Tempero da Vovó',
      'Pizzaria Bella Itália',
      'Lanchonete e Hamburgueria do Marcão',
      'Cantina Di Napoli',
      'Churrascaria Brasa de Ouro',
      'Restaurante Sabor & Cia',
      'Ponto do Pastel e Caldo de Cana',
      'Padaria e Confeitaria Pão de Mel'
    ];
  } else if (queryLower.includes('salao') || queryLower.includes('barbear') || queryLower.includes('estetic') || queryLower.includes('cabelo')) {
    categoryName = 'Salão & Estética';
    categoryKey = 'estetica';
    businessNames = [
      'Barbearia Vintage Club',
      'Salão de Beleza Fios & Formas',
      'Espaço VIP Estética e Cabelo',
      'Barbearia Navalha de Ouro',
      'Espaço Nails & Lashes',
      'Studio de Estética Renata Costa',
      'Clínica de Estética Corporal e Facial',
      'Hair Stylist Coiffeur'
    ];
  } else if (queryLower.includes('pet') || queryLower.includes('veterin') || queryLower.includes('banho')) {
    categoryName = 'Pet Shop / Veterinária';
    categoryKey = 'pet';
    businessNames = [
      'Amigo Fiel Pet Shop',
      'Clínica Veterinária Quatro Patas',
      'Pet Shop & Banho e Tosa Cão Feliz',
      'Mundo Animal Clínica e Acessórios',
      'Pet Stop Santo André',
      'Veterinária Dr. Dog',
      'Estética Canina e Felina',
      'Pet Delivery e Rações'
    ];
  } else {
    // Genérico
    categoryName = 'Comércio Local';
    categoryKey = 'local';
    businessNames = [
      'Mercadinho do Bairro',
      'Bazar e Papelaria Central',
      'Lojas Tem Tudo',
      'Floricultura Florescer',
      'Academia Iron Fitness',
      'Confecções e Moda Atual',
      'Eletro Instalações Residenciais',
      'Chaveiro e Carimbos Express'
    ];
  }

  const phonePrefixes = ['(11) 98765-', '(11) 99123-', '(11) 97112-', '(21) 98845-', '(31) 99564-'];
  const streets = ['Rua Voluntários da Pátria', 'Avenida Dom Pedro II', 'Rua das Figueiras', 'Avenida Industrial', 'Alameda São Caetano', 'Rua Augusta', 'Rua XV de Novembro', 'Avenida Brasil'];

  // Criar 8 resultados simulados
  return businessNames.map((name, index) => {
    // 2 dos 8 têm site fictício para mostrar a filtragem
    const hasWebsite = index === 1 || index === 5;
    const websiteDomain = name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-z0-9]/g, '') // remove especiais
      .substring(0, 15);

    const rating = parseFloat((3.5 + Math.random() * 1.5).toFixed(1));
    const userRatingsTotal = Math.floor(10 + Math.random() * 280);

    return {
      place_id: `mock_place_${categoryKey}_${index}_${Date.now()}`,
      name: `${name} - ${location}`,
      phone: `${phonePrefixes[index % phonePrefixes.length]}${Math.floor(1000 + Math.random() * 9000)}`,
      address: `${streets[index % streets.length]}, ${100 + index * 42} - ${location}`,
      rating: rating,
      user_ratings_total: userRatingsTotal,
      category: categoryName,
      latitude: -23.6 + (Math.random() * 0.1),
      longitude: -46.5 - (Math.random() * 0.1),
      website: hasWebsite ? `https://www.${websiteDomain}.com.br` : null,
      has_website: hasWebsite,
      opening_hours: 'Seg-Sáb: 08:00–18:00',
      source: 'google_maps'
    };
  });
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[Server] Rodando em http://localhost:${PORT}`);
});
