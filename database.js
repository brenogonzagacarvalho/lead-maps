import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'leads.db');
let db;

const LEAD_EXTRA_COLUMNS = [
  { name: 'instagram', definition: "TEXT DEFAULT ''" },
  { name: 'followers', definition: "TEXT DEFAULT ''" },
  { name: 'bio', definition: "TEXT DEFAULT ''" },
  { name: 'services', definition: "TEXT DEFAULT ''" },
  { name: 'opening_hours', definition: "TEXT DEFAULT ''" },
  { name: 'website', definition: "TEXT DEFAULT ''" },
  { name: 'bio_link', definition: "TEXT DEFAULT ''" },
  { name: 'brand_color', definition: "TEXT DEFAULT ''" },
  { name: 'source', definition: "TEXT DEFAULT 'google_maps'" },
  { name: 'reviews_sample', definition: "TEXT DEFAULT ''" },
  { name: 'last_contacted_at', definition: 'DATETIME' },
  { name: 'proposal_viewed_at', definition: 'DATETIME' },
  { name: 'proposal_views', definition: 'INTEGER DEFAULT 0' }
];

const UPDATABLE_LEAD_FIELDS = [
  'name',
  'phone',
  'address',
  'rating',
  'user_ratings_total',
  'category',
  'status',
  'notes',
  'instagram',
  'followers',
  'bio',
  'services',
  'opening_hours',
  'website',
  'bio_link',
  'brand_color',
  'source',
  'reviews_sample',
  'last_contacted_at',
  'proposal_viewed_at',
  'proposal_views'
];

export function normalizePhoneDigits(phone) {
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

export function normalizeInstagram(handle) {
  if (!handle || typeof handle !== 'string') return '';
  let clean = handle.trim().toLowerCase();
  if (!clean) return '';

  // Remove URL completa do Instagram se vier colada
  clean = clean
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .split(/[/?#]/)[0]
    .trim();

  if (!clean) return '';
  clean = clean.replace(/^@+/, '');
  if (!clean) return '';
  return `@${clean}`;
}

function serializeJsonField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function phonesMatch(digitsA, digitsB) {
  if (!digitsA || !digitsB) return false;
  if (digitsA === digitsB) return true;

  // Comparar últimos 10/11 dígitos ou mesmo DDD + 8 últimos dígitos quando ambos têm DDD
  if (digitsA.length >= 10 && digitsB.length >= 10) {
    if (digitsA.slice(-10) === digitsB.slice(-10)) return true;
    if (digitsA.slice(0, 2) === digitsB.slice(0, 2) && digitsA.slice(-8) === digitsB.slice(-8)) {
      return true;
    }
    return false;
  }

  // Fallback para comparação quando um dos números veio sem DDD (9 dígitos)
  if (digitsA.length >= 9 && digitsB.length >= 9 && digitsA.slice(-9) === digitsB.slice(-9)) {
    return true;
  }

  return false;
}

export function initDb() {
  db = new DatabaseSync(dbPath);

  // Criar tabela de leads se não existir
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      rating REAL,
      user_ratings_total INTEGER,
      category TEXT,
      latitude REAL,
      longitude REAL,
      status TEXT DEFAULT 'novo',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migração idempotente das colunas novas
  const existingCols = new Set(
    db.prepare('PRAGMA table_info(leads)').all().map(col => col.name)
  );

  for (const col of LEAD_EXTRA_COLUMNS) {
    if (!existingCols.has(col.name)) {
      db.exec(`ALTER TABLE leads ADD COLUMN ${col.name} ${col.definition}`);
    }
  }

  console.log(`[Database] Banco de dados inicializado com sucesso em: ${dbPath}`);
}

export function getAllLeads() {
  const stmt = db.prepare('SELECT * FROM leads ORDER BY created_at DESC');
  return stmt.all();
}

export function getLeadById(id) {
  const stmt = db.prepare('SELECT * FROM leads WHERE id = ?');
  return stmt.get(id);
}

export function getLeadByPlaceId(placeId) {
  const stmt = db.prepare('SELECT * FROM leads WHERE place_id = ?');
  return stmt.get(placeId);
}

export function findDuplicateLead({ place_id, phone, instagram, name } = {}) {
  if (place_id) {
    const byPlaceId = getLeadByPlaceId(place_id);
    if (byPlaceId) return byPlaceId;
  }

  const normalizedIg = normalizeInstagram(instagram);
  if (normalizedIg) {
    const bareHandle = normalizedIg.replace(/^@/, '');
    const byIg = db
      .prepare("SELECT * FROM leads WHERE instagram IS NOT NULL AND instagram != '' AND LOWER(REPLACE(instagram, '@', '')) = ? LIMIT 1")
      .get(bareHandle);
    if (byIg) return byIg;
  }

  const normalizedPhone = normalizePhoneDigits(phone);
  if (normalizedPhone.length >= 10) {
    const candidates = db
      .prepare("SELECT * FROM leads WHERE phone IS NOT NULL AND phone != ''")
      .all();
    for (const candidate of candidates) {
      const candidateDigits = normalizePhoneDigits(candidate.phone);
      if (phonesMatch(normalizedPhone, candidateDigits)) {
        return candidate;
      }
    }
  }

  if (name && typeof name === 'string' && name.trim()) {
    const byName = db
      .prepare('SELECT * FROM leads WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1')
      .get(name.trim());
    if (byName) return byName;
  }

  return null;
}

export function createLead(lead) {
  const existing = findDuplicateLead(lead);
  if (existing) {
    return { ...existing, _duplicate: true };
  }

  const normalizedIg = normalizeInstagram(lead.instagram);
  const servicesStr = serializeJsonField(lead.services);
  const reviewsStr = serializeJsonField(lead.reviews_sample);

  const stmt = db.prepare(`
    INSERT INTO leads (
      place_id, name, phone, address, rating, user_ratings_total, category,
      latitude, longitude, status, notes, instagram, followers, bio, services,
      opening_hours, website, bio_link, brand_color, source, reviews_sample,
      last_contacted_at, proposal_viewed_at, proposal_views
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  const res = stmt.run(
    lead.place_id || null,
    (lead.name || '').trim(),
    lead.phone || '',
    lead.address || '',
    Number(lead.rating) || 0,
    parseInt(lead.user_ratings_total, 10) || 0,
    lead.category || '',
    lead.latitude ?? null,
    lead.longitude ?? null,
    lead.status || 'novo',
    lead.notes || '',
    normalizedIg,
    lead.followers || '',
    lead.bio || '',
    servicesStr,
    lead.opening_hours || '',
    lead.website || '',
    lead.bio_link || '',
    lead.brand_color || '',
    lead.source || 'google_maps',
    reviewsStr,
    lead.last_contacted_at || null,
    lead.proposal_viewed_at || null,
    parseInt(lead.proposal_views, 10) || 0
  );

  const created = getLeadById(res.lastInsertRowid);
  return { ...created, _duplicate: false };
}

export function updateLead(id, data) {
  const existing = getLeadById(id);
  if (!existing) return null;

  const payload = { ...data };

  // Anexar nota ao histórico existente sem sobrescrever
  if (typeof payload.append_note === 'string' && payload.append_note.trim()) {
    const addition = payload.append_note.trim();
    const baseNotes = (existing.notes || '').trimEnd();
    payload.notes = baseNotes ? `${baseNotes}\n${addition}` : addition;
    delete payload.append_note;
  }

  const fields = [];
  const values = [];

  for (const [key, val] of Object.entries(payload)) {
    if (!UPDATABLE_LEAD_FIELDS.includes(key)) continue;

    let normalizedVal = val;
    if (key === 'instagram') {
      normalizedVal = normalizeInstagram(val);
    } else if (key === 'services' || key === 'reviews_sample') {
      normalizedVal = serializeJsonField(val);
    }

    fields.push(`${key} = ?`);
    values.push(normalizedVal);
  }

  if (fields.length === 0) return existing;

  values.push(id);
  const stmt = db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getLeadById(id);
}

export function recordProposalView(id) {
  const existing = getLeadById(id);
  if (!existing) return null;

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const shouldPromote = existing.status === 'novo' || existing.status === 'contactado';

  return updateLead(id, {
    proposal_views: (existing.proposal_views || 0) + 1,
    proposal_viewed_at: now.toISOString(),
    status: shouldPromote ? 'proposta' : existing.status,
    append_note: `[Sistema] Proposta visualizada online em ${dateStr} ${timeStr}.`
  });
}

export function deleteLead(id) {
  const stmt = db.prepare('DELETE FROM leads WHERE id = ?');
  const res = stmt.run(id);
  return res.changes > 0;
}

export function runInTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignora erro de rollback se transação já estiver encerrada
    }
    throw err;
  }
}
