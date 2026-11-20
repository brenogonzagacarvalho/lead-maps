export const VALID_LEAD_STATUSES = [
  'novo',
  'contactado',
  'negociacao',
  'proposta',
  'ganho',
  'perdido'
];

export const AGGREGATOR_DOMAINS = [
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

export const CSV_FIELDS = [
  {
    key: 'name',
    label: 'Nome da Empresa *',
    required: true,
    aliases: [
      'nome',
      'name',
      'empresa',
      'nome da empresa',
      'loja',
      'estabelecimento',
      'razao social',
      'nome fantasia',
      'titulo',
      'title',
      'business',
      'business name',
      'lead'
    ]
  },
  {
    key: 'category',
    label: 'Categoria / Nicho',
    aliases: ['categoria', 'category', 'nicho', 'segmento', 'ramo', 'atividade', 'primary type']
  },
  {
    key: 'phone',
    label: 'Telefone / WhatsApp',
    aliases: [
      'telefone',
      'phone',
      'whatsapp',
      'celular',
      'fone',
      'contato',
      'tel',
      'numero',
      'phone number',
      'national phone',
      'national phone number'
    ]
  },
  {
    key: 'instagram',
    label: 'Instagram (@usuario)',
    aliases: ['instagram', 'insta', 'ig', 'arroba', 'handle', 'perfil instagram']
  },
  {
    key: 'instagram_url',
    label: 'Link do Instagram',
    aliases: ['link instagram', 'url instagram', 'instagram url', 'instagram link']
  },
  {
    key: 'bio_link',
    label: 'Link da Bio',
    aliases: ['link bio', 'link na bio', 'bio link', 'linktree', 'agregador']
  },
  {
    key: 'address',
    label: 'Endereço / Bairro',
    aliases: [
      'endereco',
      'address',
      'rua',
      'logradouro',
      'localizacao',
      'bairro',
      'cidade',
      'formatted address'
    ]
  },
  {
    key: 'opening_hours',
    label: 'Horário de Funcionamento',
    aliases: [
      'horario',
      'horarios',
      'opening hours',
      'horario de funcionamento',
      'funcionamento',
      'hours'
    ]
  },
  {
    key: 'website',
    label: 'Site Próprio',
    aliases: ['site', 'website', 'url', 'dominio', 'pagina', 'website uri', 'site proprio']
  },
  {
    key: 'has_website',
    label: 'Tem Site (Sim/Não)',
    aliases: ['tem site', 'possui site', 'has website', 'com site']
  },
  {
    key: 'rating',
    label: 'Avaliação / Estrelas',
    aliases: ['avaliacao', 'rating', 'nota', 'estrelas', 'stars', 'score']
  },
  {
    key: 'user_ratings_total',
    label: 'Qtd. Avaliações',
    aliases: [
      'avaliacoes',
      'total avaliacoes',
      'qtd avaliacoes',
      'numero avaliacoes',
      'reviews',
      'user ratings total',
      'user rating count'
    ]
  },
  {
    key: 'bio',
    label: 'Bio / Descrição',
    aliases: ['bio', 'descricao', 'description', 'sobre', 'resumo']
  },
  {
    key: 'notes',
    label: 'Anotações / Observações',
    aliases: ['notas', 'anotacoes', 'observacoes', 'obs', 'notes', 'comentarios']
  },
  {
    key: 'status',
    label: 'Etapa do Funil',
    aliases: ['status', 'etapa', 'fase', 'estagio', 'stage']
  }
];

const EXCLUDED_AUTO_MAP_HEADERS = new Set([
  'tipo telefone',
  'phone type',
  'link google maps',
  'google maps',
  'url google maps',
  'maps'
]);

const INSTAGRAM_RESERVED_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'accounts',
  'tv',
  'direct',
  'about',
  'legal',
  'developer',
  'directory'
]);

function stripBom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '');
}

export function normalizeHeaderKey(header) {
  return String(header || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function detectCsvDelimiter(text) {
  const clean = stripBom(text);
  const candidates = [';', ',', '\t'];
  const lineCounts = { ';': [], ',': [], '\t': [] };

  let inQuotes = false;
  let currentCounts = { ';': 0, ',': 0, '\t': 0 };
  let linesRead = 0;

  for (let i = 0; i < clean.length && linesRead < 5; i++) {
    const ch = clean[i];
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      const hasAny =
        currentCounts[';'] > 0 || currentCounts[','] > 0 || currentCounts['\t'] > 0;
      if (hasAny) {
        for (const delim of candidates) {
          lineCounts[delim].push(currentCounts[delim]);
        }
        linesRead++;
      }
      currentCounts = { ';': 0, ',': 0, '\t': 0 };
      continue;
    }

    if (!inQuotes && Object.prototype.hasOwnProperty.call(currentCounts, ch)) {
      currentCounts[ch]++;
    }
  }

  if (
    linesRead < 5 &&
    (currentCounts[';'] > 0 || currentCounts[','] > 0 || currentCounts['\t'] > 0)
  ) {
    for (const delim of candidates) {
      lineCounts[delim].push(currentCounts[delim]);
    }
  }

  const scoreDelimiter = delim => {
    const counts = lineCounts[delim];
    if (!counts.length) return 0;
    const total = counts.reduce((acc, n) => acc + n, 0);
    const nonZeroLines = counts.filter(n => n > 0).length;
    const consistent = counts.length > 1 && counts.every(n => n === counts[0] && n > 0);
    return total + nonZeroLines * 2 + (consistent ? 50 : 0);
  };

  const semiScore = scoreDelimiter(';');
  const commaScore = scoreDelimiter(',');
  const tabScore = scoreDelimiter('\t');

  if (tabScore > semiScore && tabScore > commaScore) return '\t';
  if (semiScore > 0 && semiScore >= commaScore) return ';';
  if (commaScore > 0) return ',';
  return ';';
}

export function parseCsvText(text, forcedDelimiter = null) {
  const clean = stripBom(text);
  const delimiter = forcedDelimiter || detectCsvDelimiter(clean);

  if (!clean.trim()) {
    return { delimiter, headers: [], rows: [] };
  }

  const matrix = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (cell.length === 0) {
        inQuotes = true;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      matrix.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    matrix.push(row);
  }

  while (matrix.length > 0 && matrix[matrix.length - 1].every(c => !String(c || '').trim())) {
    matrix.pop();
  }

  if (matrix.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }

  const headers = matrix[0].map(h => String(h ?? '').trim());
  const rows = matrix
    .slice(1)
    .filter(r => r.some(c => String(c ?? '').trim() !== ''));

  return { delimiter, headers, rows };
}

export function autoMapCsvHeaders(headers) {
  const normalizedHeaders = (headers || []).map(h => normalizeHeaderKey(h));
  const usedCols = new Set();
  const mapping = {};

  for (const field of CSV_FIELDS) {
    mapping[field.key] = -1;
  }

  // Passo 1: correspondência exata
  for (const field of CSV_FIELDS) {
    const idx = normalizedHeaders.findIndex(
      (norm, colIdx) => !usedCols.has(colIdx) && field.aliases.includes(norm)
    );
    if (idx !== -1) {
      mapping[field.key] = idx;
      usedCols.add(idx);
    }
  }

  // Passo 2: correspondência por palavra inteira para aliases descritivos
  for (const field of CSV_FIELDS) {
    if (mapping[field.key] !== -1) continue;
    const idx = normalizedHeaders.findIndex((norm, colIdx) => {
      if (usedCols.has(colIdx) || !norm || EXCLUDED_AUTO_MAP_HEADERS.has(norm)) return false;
      return field.aliases.some(alias => {
        if (alias.length < 3) return false;
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(norm);
      });
    });
    if (idx !== -1) {
      mapping[field.key] = idx;
      usedCols.add(idx);
    }
  }

  return mapping;
}

export function normalizeCsvPhone(raw) {
  if (raw === null || raw === undefined) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('sem telefone') ||
    lower.includes('sem contato') ||
    lower.includes('indispon') ||
    /^(sem|n\/?a|null|undefined|-+|0+)$/i.test(trimmed)
  ) {
    return '';
  }
  return trimmed;
}

export function extractInstagramHandle(raw) {
  if (raw === null || raw === undefined) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('google.com/search') ||
    lower.includes('google.com.br/search') ||
    lower.includes('maps.google.') ||
    lower.includes('google.com/maps')
  ) {
    return '';
  }

  const igUrlMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (igUrlMatch) {
    const candidate = igUrlMatch[1].toLowerCase().replace(/^@+/, '').trim();
    if (!candidate || INSTAGRAM_RESERVED_PATHS.has(candidate)) return '';
    return `@${candidate}`;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('/')) {
    return '';
  }

  const clean = trimmed.replace(/^@+/, '').trim().toLowerCase();
  if (!clean || clean === 'sem' || clean === 'nao' || clean === 'não') return '';
  if (!/^[a-z0-9._]{1,30}$/.test(clean)) return '';
  return `@${clean}`;
}

export function isAggregatorUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase().trim();
  return AGGREGATOR_DOMAINS.some(domain => lower.includes(domain));
}

export function parseRatingValue(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const normalized = String(raw).trim().replace(',', '.');
  const num = parseFloat(normalized);
  if (!Number.isFinite(num)) return 0;
  return Math.min(5, Math.max(0, num));
}

export function parseBooleanPtBr(raw) {
  if (typeof raw === 'boolean') return raw;
  const norm = normalizeHeaderKey(raw);
  return ['sim', 'yes', 'true', '1', 's', 'y'].includes(norm);
}

export function normalizeStatus(raw, fallback = 'novo') {
  const norm = normalizeHeaderKey(raw);
  if (!norm) return fallback;
  if (VALID_LEAD_STATUSES.includes(norm)) return norm;
  if (norm === 'fechado' || norm === 'ganha' || norm === 'cliente') return 'ganho';
  if (norm === 'em negociacao' || norm === 'negociando') return 'negociacao';
  if (norm === 'proposta enviada' || norm === 'orcamento') return 'proposta';
  if (norm === 'contatado' || norm === 'abordado') return 'contactado';
  if (norm === 'descartado' || norm === 'perdida') return 'perdido';
  return fallback;
}

export function normalizePhoneDigitsForMatch(phone) {
  if (!phone || typeof phone !== 'string') return '';
  if (phone.toLowerCase().includes('sem')) return '';
  let digits = phone.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  if (digits.length > 11) {
    digits = digits.slice(-11);
  }
  return digits;
}

export function phonesMatch(digitsA, digitsB) {
  if (!digitsA || !digitsB) return false;
  if (digitsA === digitsB) return true;

  if (digitsA.length >= 10 && digitsB.length >= 10) {
    if (digitsA.slice(-10) === digitsB.slice(-10)) return true;
    if (digitsA.slice(0, 2) === digitsB.slice(0, 2) && digitsA.slice(-8) === digitsB.slice(-8)) {
      return true;
    }
    return false;
  }

  if (digitsA.length >= 9 && digitsB.length >= 9 && digitsA.slice(-9) === digitsB.slice(-9)) {
    return true;
  }

  return false;
}

export function classifyCsvPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return 'ausente';
  const trimmed = normalizeCsvPhone(rawPhone);
  if (!trimmed) return 'ausente';
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return 'ausente';
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  if (/^[1-9]{2}9\d{8}$/.test(digits) || /^9\d{8}$/.test(digits)) return 'celular';
  if (/^[1-9]{2}[2-5]\d{7}$/.test(digits) || /^\d{8}$/.test(digits)) return 'fixo';
  return 'invalido';
}

export function findMatchingLead(candidate, existingLeads = []) {
  if (!candidate || !Array.isArray(existingLeads) || existingLeads.length === 0) return null;

  const candIg = extractInstagramHandle(candidate.instagram).replace(/^@/, '');
  const candPhone = normalizePhoneDigitsForMatch(candidate.phone);
  const candName = String(candidate.name || '').trim().toLowerCase();

  for (const lead of existingLeads) {
    if (!lead) continue;
    if (candidate.place_id && lead.place_id && candidate.place_id === lead.place_id) {
      return lead;
    }
    if (candIg) {
      const leadIg = extractInstagramHandle(lead.instagram).replace(/^@/, '');
      if (leadIg && leadIg === candIg) return lead;
    }
    if (candPhone.length >= 10) {
      const leadPhone = normalizePhoneDigitsForMatch(lead.phone);
      if (phonesMatch(candPhone, leadPhone)) return lead;
    }
    if (candName) {
      const leadName = String(lead.name || '').trim().toLowerCase();
      if (leadName && leadName === candName) return lead;
    }
  }

  return null;
}

function getMappedCell(row, mapping, key) {
  const idx = Number(mapping?.[key]);
  if (!Number.isInteger(idx) || idx < 0 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

export function mapCsvRowsToLeads(headers, rows, mapping, options = {}) {
  const { filename = 'arquivo.csv', defaultStatus = 'novo' } = options;
  const safeDefaultStatus = VALID_LEAD_STATUSES.includes(defaultStatus) ? defaultStatus : 'novo';
  const dateStr = new Date().toLocaleDateString('pt-BR');
  const importTag = `[CSV] Importado de ${filename} em ${dateStr}.`;

  return (rows || []).map((row, rowIndex) => {
    const name = getMappedCell(row, mapping, 'name');
    const category = getMappedCell(row, mapping, 'category') || 'Negócio Local';
    const phone = normalizeCsvPhone(getMappedCell(row, mapping, 'phone'));
    const rawInstagram = getMappedCell(row, mapping, 'instagram');
    const rawInstagramUrl = getMappedCell(row, mapping, 'instagram_url');
    let instagram = extractInstagramHandle(rawInstagram);
    if (!instagram && rawInstagramUrl) {
      instagram = extractInstagramHandle(rawInstagramUrl);
    }

    const address = getMappedCell(row, mapping, 'address');
    const opening_hours = getMappedCell(row, mapping, 'opening_hours');
    let bio_link = getMappedCell(row, mapping, 'bio_link');
    let website = getMappedCell(row, mapping, 'website');

    const normalizedWebsiteWord = normalizeHeaderKey(website);
    if (
      !website ||
      ['nao', 'n', 'sem site', 'nenhum', 'false', '0', 'ausente'].includes(normalizedWebsiteWord) ||
      website === '-'
    ) {
      website = '';
    } else if (isAggregatorUrl(website)) {
      if (!bio_link) bio_link = website;
      website = '';
    }

    const hasWebsiteFlag = parseBooleanPtBr(getMappedCell(row, mapping, 'has_website'));
    const has_website = Boolean(website) || hasWebsiteFlag;

    const rating = parseRatingValue(getMappedCell(row, mapping, 'rating'));
    const parsedReviews = parseInt(getMappedCell(row, mapping, 'user_ratings_total'), 10);
    const user_ratings_total = Number.isFinite(parsedReviews) && parsedReviews > 0 ? parsedReviews : 0;
    const bio = getMappedCell(row, mapping, 'bio');
    const status = normalizeStatus(getMappedCell(row, mapping, 'status'), safeDefaultStatus);

    const rawNotes = getMappedCell(row, mapping, 'notes');
    let notes = importTag;
    if (rawNotes) {
      notes = rawNotes.includes('[CSV]') ? rawNotes : `${rawNotes}\n${importTag}`;
    }

    return {
      _rowNumber: rowIndex + 2,
      name,
      category,
      phone,
      instagram,
      address,
      opening_hours,
      website,
      bio_link,
      has_website,
      rating,
      user_ratings_total,
      bio,
      status,
      notes,
      source: 'csv',
      valid: Boolean(name)
    };
  });
}

export function buildCsvTemplate() {
  const lines = [
    'Nome;Categoria;Telefone;Instagram;Link Bio;Endereço;Horário;Avaliação;Tem Site;Site;Observações',
    'Clínica Bella Pele;Clínica de Estética;(85) 99999-1111;@clinicabellapele;https://linktr.ee/clinicabellapele;Av. Dom Luís, 500 • Aldeota • Fortaleza - CE;Seg-Sáb 08:00-19:00;4,9;Não;;Perfil ativo no Instagram sem site próprio',
    'Oficina Turbo Fortaleza;Oficina Mecânica;(85) 3222-4455;;;"Rua Monsenhor Bruno, 120 • Joaquim Távora • Fortaleza - CE";"Seg-Sex 08:00-18:00; Sáb 08:00-12:00";4,7;Não;;Atende revisão e injeção eletrônica'
  ];
  return '\uFEFF' + lines.join('\r\n');
}
