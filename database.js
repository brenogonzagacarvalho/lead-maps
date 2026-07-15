import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'leads.db');
let db;

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

export function createLead(lead) {
  // Verifica se o lead com esse place_id já existe para evitar duplicados
  if (lead.place_id) {
    const existing = getLeadByPlaceId(lead.place_id);
    if (existing) {
      return existing;
    }
  }

  const stmt = db.prepare(`
    INSERT INTO leads (
      place_id, name, phone, address, rating, user_ratings_total, category, latitude, longitude, status, notes
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const res = stmt.run(
    lead.place_id || null,
    lead.name,
    lead.phone || '',
    lead.address || '',
    lead.rating || 0,
    lead.user_ratings_total || 0,
    lead.category || '',
    lead.latitude || null,
    lead.longitude || null,
    lead.status || 'novo',
    lead.notes || ''
  );

  return { id: res.lastInsertRowid, ...lead };
}

export function updateLead(id, data) {
  const fields = [];
  const values = [];

  for (const [key, val] of Object.entries(data)) {
    // Apenas atualiza campos válidos
    if (['name', 'phone', 'address', 'rating', 'user_ratings_total', 'category', 'status', 'notes'].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return getLeadById(id);

  values.push(id);
  const stmt = db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getLeadById(id);
}

export function deleteLead(id) {
  const stmt = db.prepare('DELETE FROM leads WHERE id = ?');
  const res = stmt.run(id);
  return res.changes > 0;
}
