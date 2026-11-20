import {
  CSV_FIELDS,
  parseCsvText,
  autoMapCsvHeaders,
  mapCsvRowsToLeads,
  buildCsvTemplate,
  classifyCsvPhone,
  findMatchingLead
} from './csv-core.js';

const PAGE_SIZE = 25;

const csvState = {
  rawText: '',
  filename: '',
  encoding: 'UTF-8',
  delimiter: ';',
  forcedDelimiter: '',
  headers: [],
  rows: [],
  mapping: {},
  evaluatedRows: [],
  selectedRows: new Set(),
  currentPage: 1,
  filters: {
    skipWithWebsite: true,
    onlyWithContact: false,
    skipDuplicates: true,
    defaultStatus: 'novo',
    search: ''
  }
};

function decodeCsvBuffer(buffer) {
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text: utf8, encoding: 'UTF-8' };
  } catch {
    const win1252 = new TextDecoder('windows-1252').decode(buffer);
    return { text: win1252, encoding: 'Windows-1252' };
  }
}

function delimiterLabel(delim) {
  if (delim === ';') return 'Ponto e vírgula (;)';
  if (delim === ',') return 'Vírgula (,)';
  if (delim === '\t') return 'Tabulação (TAB)';
  return delim;
}

function getSafeCrmLeads() {
  if (typeof window.getCrmLeadsList === 'function') {
    return window.getCrmLeadsList() || [];
  }
  return [];
}

function getRowSearchBlob(item) {
  return [item.name, item.category, item.phone, item.instagram, item.address]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function evaluateCsvRows({ resetSelection = false } = {}) {
  if (csvState.headers.length === 0) {
    csvState.evaluatedRows = [];
    return;
  }

  const mapped = mapCsvRowsToLeads(csvState.headers, csvState.rows, csvState.mapping, {
    filename: csvState.filename || 'planilha.csv',
    defaultStatus: csvState.filters.defaultStatus
  });

  const crmLeads = getSafeCrmLeads();
  const seenInCsv = [];

  csvState.evaluatedRows = mapped.map(item => {
    const phoneType = classifyCsvPhone(item.phone);
    const hasContact =
      Boolean(item.instagram) || phoneType === 'celular' || phoneType === 'fixo';

    let statusCode = 'eligible';
    let statusLabel = 'Pronto';
    let dupLead = null;

    if (!item.valid) {
      statusCode = 'invalid';
      statusLabel = 'Sem nome';
    } else if (csvState.filters.skipWithWebsite && item.has_website) {
      statusCode = 'with_website';
      statusLabel = 'Tem site';
    } else if (csvState.filters.onlyWithContact && !hasContact) {
      statusCode = 'no_contact';
      statusLabel = 'Sem contato';
    } else {
      dupLead = findMatchingLead(item, crmLeads);
      if (dupLead) {
        statusCode = 'duplicate_crm';
        statusLabel = 'Já no CRM';
      } else if (findMatchingLead(item, seenInCsv)) {
        statusCode = 'duplicate_csv';
        statusLabel = 'Duplicado CSV';
      }
    }

    if (item.valid && statusCode === 'eligible') {
      seenInCsv.push(item);
    }

    const isDup = statusCode === 'duplicate_crm' || statusCode === 'duplicate_csv';
    const selectable =
      item.valid &&
      statusCode !== 'with_website' &&
      statusCode !== 'no_contact' &&
      (!csvState.filters.skipDuplicates || !isDup);

    return {
      ...item,
      phoneType,
      hasContact,
      statusCode,
      statusLabel,
      duplicateLeadId: dupLead ? dupLead.id : null,
      selectable
    };
  });

  if (resetSelection) {
    csvState.selectedRows = new Set(
      csvState.evaluatedRows.filter(r => r.selectable).map(r => r._rowNumber)
    );
  } else {
    const validSelectable = new Set(
      csvState.evaluatedRows.filter(r => r.selectable).map(r => r._rowNumber)
    );
    csvState.selectedRows = new Set(
      Array.from(csvState.selectedRows).filter(id => validSelectable.has(id))
    );
  }
}

function getVisiblePreviewRows() {
  const term = csvState.filters.search.trim().toLowerCase();
  if (!term) return csvState.evaluatedRows;
  return csvState.evaluatedRows.filter(item => getRowSearchBlob(item).includes(term));
}

function renderMappingGrid() {
  const container = document.getElementById('csv-mapping-grid');
  if (!container) return;

  const optionsHtml = [
    '<option value="-1">— Ignorar coluna —</option>',
    ...csvState.headers.map(
      (header, idx) =>
        `<option value="${idx}">${escapeHtml(header || `Coluna ${idx + 1}`)}</option>`
    )
  ].join('');

  container.innerHTML = CSV_FIELDS.map(field => {
    const selectedIdx = Number.isInteger(csvState.mapping[field.key])
      ? csvState.mapping[field.key]
      : -1;
    return `
      <div class="csv-map-item">
        <label for="csv-map-${field.key}">${escapeHtml(field.label)}</label>
        <select
          id="csv-map-${field.key}"
          class="form-input csv-map-select"
          onchange="handleCsvMappingChange('${field.key}', this.value)"
        >
          ${optionsHtml}
        </select>
      </div>
    `;
  }).join('');

  for (const field of CSV_FIELDS) {
    const sel = document.getElementById(`csv-map-${field.key}`);
    if (sel) {
      sel.value = String(
        Number.isInteger(csvState.mapping[field.key]) ? csvState.mapping[field.key] : -1
      );
    }
  }
}

function renderSummaryAndStats() {
  const total = csvState.evaluatedRows.length;
  const eligible = csvState.evaluatedRows.filter(r => r.statusCode === 'eligible').length;
  const duplicates = csvState.evaluatedRows.filter(
    r => r.statusCode === 'duplicate_crm' || r.statusCode === 'duplicate_csv'
  ).length;
  const filtered = csvState.evaluatedRows.filter(
    r => r.statusCode === 'with_website' || r.statusCode === 'no_contact' || r.statusCode === 'invalid'
  ).length;

  document.getElementById('csv-stat-total').innerText = total;
  document.getElementById('csv-stat-eligible').innerText = eligible;
  document.getElementById('csv-stat-duplicates').innerText = duplicates;
  document.getElementById('csv-stat-filtered').innerText = filtered;

  const selectedCount = csvState.selectedRows.size;
  const importBtn = document.getElementById('csv-import-btn');
  const hasNameCol = Number.isInteger(csvState.mapping.name) && csvState.mapping.name >= 0;
  importBtn.disabled = selectedCount === 0 || !hasNameCol;
  importBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Importar Selecionados no CRM (${selectedCount})`;

  const metaEl = document.getElementById('csv-file-meta');
  metaEl.innerHTML = `
    <span class="badge" style="background: rgba(56,189,248,0.14); color: var(--accent-blue); border: 1px solid rgba(56,189,248,0.3);">
      <i class="fa-solid fa-file-csv"></i> ${escapeHtml(csvState.filename || 'Texto colado')}
    </span>
    <span class="badge" style="background: rgba(139,92,246,0.14); color: var(--accent-purple); border: 1px solid rgba(139,92,246,0.3);">
      ${escapeHtml(csvState.encoding)} • ${escapeHtml(delimiterLabel(csvState.delimiter))}
    </span>
    <span style="color: var(--text-muted); font-size: 0.85rem;">
      ${csvState.headers.length} colunas • ${total} linhas lidas
    </span>
  `;
}

function getStatusBadgeHtml(row) {
  if (row.statusCode === 'eligible') {
    return '<span class="badge badge-csv-ready"><i class="fa-solid fa-check"></i> Pronto</span>';
  }
  if (row.statusCode === 'duplicate_crm') {
    return '<span class="badge badge-csv-dup"><i class="fa-solid fa-clone"></i> Já no CRM</span>';
  }
  if (row.statusCode === 'duplicate_csv') {
    return '<span class="badge badge-csv-dup"><i class="fa-solid fa-copy"></i> Duplicado CSV</span>';
  }
  if (row.statusCode === 'with_website') {
    return '<span class="badge badge-csv-skip"><i class="fa-solid fa-globe"></i> Tem site</span>';
  }
  if (row.statusCode === 'no_contact') {
    return '<span class="badge badge-csv-skip"><i class="fa-solid fa-phone-slash"></i> Sem contato</span>';
  }
  return '<span class="badge badge-csv-invalid"><i class="fa-solid fa-triangle-exclamation"></i> Sem nome</span>';
}

function renderPreviewTable() {
  const tbody = document.getElementById('csv-preview-tbody');
  const pageInfo = document.getElementById('csv-page-info');
  const prevBtn = document.getElementById('csv-prev-btn');
  const nextBtn = document.getElementById('csv-next-btn');
  const selectAllCheckbox = document.getElementById('csv-select-all');

  const visible = getVisiblePreviewRows();
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  if (csvState.currentPage > totalPages) csvState.currentPage = totalPages;
  if (csvState.currentPage < 1) csvState.currentPage = 1;

  const start = (csvState.currentPage - 1) * PAGE_SIZE;
  const pageItems = visible.slice(start, start + PAGE_SIZE);

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          Nenhuma linha encontrada com os filtros atuais.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pageItems
      .map(row => {
        const checked = csvState.selectedRows.has(row._rowNumber) ? 'checked' : '';
        const disabled = row.selectable ? '' : 'disabled';
        const rowClass = row.selectable ? '' : 'csv-row-dimmed';
        const phoneDisplay = row.phone
          ? escapeHtml(row.phone)
          : '<span style="color: var(--text-dimmed);">—</span>';
        const igDisplay = row.instagram
          ? `<span style="color: #f472b6;">${escapeHtml(row.instagram)}</span>`
          : '<span style="color: var(--text-dimmed);">—</span>';
        const siteDisplay = row.website
          ? `<span title="${escapeAttr(row.website)}" style="color: var(--accent-orange);">Sim</span>`
          : row.bio_link
          ? '<span style="color: var(--accent-blue);">Bio/Link</span>'
          : '<span style="color: var(--accent-green);">Sem site</span>';

        return `
          <tr class="${rowClass}">
            <td>
              <input
                type="checkbox"
                ${checked}
                ${disabled}
                onchange="toggleCsvRowSelection(${row._rowNumber}, this.checked)"
                style="width: 15px; height: 15px; accent-color: var(--accent-purple);"
              >
            </td>
            <td style="color: var(--text-dimmed); font-size: 0.78rem;">#${row._rowNumber}</td>
            <td>
              <div style="font-weight: 600; color: var(--text-main);">${escapeHtml(row.name || '(Sem nome)')}</div>
              ${
                row.address
                  ? `<div style="font-size: 0.75rem; color: var(--text-muted); max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeAttr(row.address)}">${escapeHtml(row.address)}</div>`
                  : ''
              }
            </td>
            <td>${escapeHtml(row.category)}</td>
            <td>${phoneDisplay}</td>
            <td>${igDisplay}</td>
            <td>${siteDisplay}</td>
            <td>${getStatusBadgeHtml(row)}</td>
          </tr>
        `;
      })
      .join('');
  }

  const selectableVisible = visible.filter(r => r.selectable);
  if (selectAllCheckbox) {
    selectAllCheckbox.disabled = selectableVisible.length === 0;
    selectAllCheckbox.checked =
      selectableVisible.length > 0 &&
      selectableVisible.every(r => csvState.selectedRows.has(r._rowNumber));
  }

  pageInfo.innerText = `Página ${csvState.currentPage} de ${totalPages} (${visible.length} linhas)`;
  prevBtn.disabled = csvState.currentPage <= 1;
  nextBtn.disabled = csvState.currentPage >= totalPages;
}

function parseAndRenderCsv({ resetMapping = true, resetSelection = true } = {}) {
  const parsed = parseCsvText(csvState.rawText, csvState.forcedDelimiter || null);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    showToast('O CSV está vazio ou não possui linhas de dados válidas.', true);
    return false;
  }

  csvState.delimiter = parsed.delimiter;
  csvState.headers = parsed.headers;
  csvState.rows = parsed.rows;
  if (resetMapping) {
    csvState.mapping = autoMapCsvHeaders(parsed.headers);
  }
  csvState.currentPage = 1;

  document.getElementById('csv-workspace').style.display = 'block';
  document.getElementById('csv-progress-container').style.display = 'none';

  renderMappingGrid();
  evaluateCsvRows({ resetSelection });
  renderSummaryAndStats();
  renderPreviewTable();

  if (csvState.mapping.name < 0) {
    showToast('Não detectamos a coluna de "Nome" automaticamente. Selecione no mapeamento acima.', true);
  }
  return true;
}

function loadCsvText(text, { filename = 'planilha.csv', encoding = 'UTF-8' } = {}) {
  csvState.rawText = text;
  csvState.filename = filename;
  csvState.encoding = encoding;
  csvState.forcedDelimiter = '';

  const delimSelect = document.getElementById('csv-delimiter-select');
  if (delimSelect) delimSelect.value = '';

  const ok = parseAndRenderCsv({ resetMapping: true, resetSelection: true });
  if (ok) {
    document.getElementById('csv-paste-panel').style.display = 'none';
    showToast(`${csvState.rows.length} linha(s) carregada(s) de "${filename}".`);
  }
}

async function handleCsvFile(file) {
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const { text, encoding } = decodeCsvBuffer(buffer);
    loadCsvText(text, { filename: file.name, encoding });
  } catch (err) {
    console.error('[CSV Import] Falha ao ler arquivo:', err);
    showToast('Não foi possível ler o arquivo CSV selecionado.', true);
  }
}

function downloadCsvTemplate() {
  const csvContent = buildCsvTemplate();
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modelo-importacao-leads.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Modelo CSV baixado!');
}

function toggleCsvPastePanel() {
  const panel = document.getElementById('csv-paste-panel');
  if (!panel) return;
  const isVisible = panel.style.display === 'block';
  panel.style.display = isVisible ? 'none' : 'block';
  if (!isVisible) {
    document.getElementById('csv-paste-input')?.focus();
  }
}

function parsePastedCsv() {
  const input = document.getElementById('csv-paste-input');
  const text = input ? input.value : '';
  if (!text.trim()) {
    showToast('Cole o conteúdo CSV antes de processar.', true);
    return;
  }
  loadCsvText(text, { filename: 'texto-colado.csv', encoding: 'UTF-8' });
}

function clearCsvImport() {
  csvState.rawText = '';
  csvState.filename = '';
  csvState.headers = [];
  csvState.rows = [];
  csvState.mapping = {};
  csvState.evaluatedRows = [];
  csvState.selectedRows = new Set();
  csvState.currentPage = 1;

  const fileInput = document.getElementById('csv-file-input');
  if (fileInput) fileInput.value = '';
  const pasteInput = document.getElementById('csv-paste-input');
  if (pasteInput) pasteInput.value = '';

  document.getElementById('csv-workspace').style.display = 'none';
  document.getElementById('csv-progress-container').style.display = 'none';
}

function handleCsvDelimiterChange() {
  const val = document.getElementById('csv-delimiter-select').value;
  csvState.forcedDelimiter = val === '\\t' ? '\t' : val;
  if (!csvState.rawText) return;
  parseAndRenderCsv({ resetMapping: true, resetSelection: true });
}

function handleCsvMappingChange(fieldKey, colIndexStr) {
  const parsedIdx = parseInt(colIndexStr, 10);
  csvState.mapping[fieldKey] = Number.isFinite(parsedIdx) ? parsedIdx : -1;
  evaluateCsvRows({ resetSelection: true });
  renderSummaryAndStats();
  renderPreviewTable();
}

function handleCsvFilterChange() {
  csvState.filters.skipWithWebsite = document.getElementById('csv-skip-with-website').checked;
  csvState.filters.onlyWithContact = document.getElementById('csv-only-with-contact').checked;
  csvState.filters.skipDuplicates = document.getElementById('csv-skip-duplicates').checked;
  csvState.filters.defaultStatus = document.getElementById('csv-default-status').value;
  csvState.filters.search = document.getElementById('csv-preview-search').value;
  csvState.currentPage = 1;

  evaluateCsvRows({ resetSelection: true });
  renderSummaryAndStats();
  renderPreviewTable();
}

function toggleSelectAllCsvRows(checked) {
  const visible = getVisiblePreviewRows();
  visible.forEach(row => {
    if (!row.selectable) return;
    if (checked) {
      csvState.selectedRows.add(row._rowNumber);
    } else {
      csvState.selectedRows.delete(row._rowNumber);
    }
  });
  renderSummaryAndStats();
  renderPreviewTable();
}

function toggleCsvRowSelection(rowNumber, checked) {
  if (checked) {
    csvState.selectedRows.add(rowNumber);
  } else {
    csvState.selectedRows.delete(rowNumber);
  }
  renderSummaryAndStats();
  renderPreviewTable();
}

function changeCsvPreviewPage(delta) {
  csvState.currentPage += delta;
  renderPreviewTable();
}

async function importSelectedCsvLeads() {
  const selectedItems = csvState.evaluatedRows.filter(
    r => r.selectable && csvState.selectedRows.has(r._rowNumber)
  );

  if (selectedItems.length === 0) {
    showToast('Selecione ao menos 1 lead válido para importar.', true);
    return;
  }

  const importBtn = document.getElementById('csv-import-btn');
  const progressBox = document.getElementById('csv-progress-container');
  const progressBar = document.getElementById('csv-progress-bar');
  const progressStatus = document.getElementById('csv-progress-status');
  const progressPercent = document.getElementById('csv-progress-percent');

  importBtn.disabled = true;
  importBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importando...';
  progressBox.style.display = 'block';
  progressBar.style.width = '5%';
  progressPercent.innerText = '5%';
  progressStatus.innerText = `Preparando importação de ${selectedItems.length} lead(s)...`;

  const chunkSize = 100;
  let totalImported = 0;
  let totalSkipped = 0;

  try {
    for (let i = 0; i < selectedItems.length; i += chunkSize) {
      const chunk = selectedItems.slice(i, i + chunkSize).map(item => ({
        name: item.name,
        phone: item.phone,
        address: item.address,
        rating: item.rating,
        user_ratings_total: item.user_ratings_total,
        category: item.category,
        instagram: item.instagram,
        bio: item.bio,
        opening_hours: item.opening_hours,
        website: item.website,
        bio_link: item.bio_link,
        source: 'csv',
        status: item.status,
        notes: item.notes
      }));

      const response = await fetch(`${getApiBase()}/leads/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: chunk })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Erro do servidor (${response.status})`);
      }

      const data = await response.json();
      totalImported += (data.imported || []).length;
      totalSkipped += (data.skipped || []).length;

      const pct = Math.min(100, Math.round(((i + chunk.length) / selectedItems.length) * 100));
      progressBar.style.width = `${pct}%`;
      progressPercent.innerText = `${pct}%`;
      progressStatus.innerText = `Importados ${totalImported} de ${selectedItems.length}...`;
    }

    if (typeof loadCrmLeads === 'function') {
      await loadCrmLeads();
    }

    evaluateCsvRows({ resetSelection: true });
    renderSummaryAndStats();
    renderPreviewTable();

    progressStatus.innerText = `Concluído: ${totalImported} importado(s), ${totalSkipped} duplicado(s)/ignorado(s).`;
    showToast(
      `Importação CSV concluída: ${totalImported} novo(s)${totalSkipped ? `, ${totalSkipped} duplicado(s)/ignorado(s)` : ''}.`
    );
  } catch (err) {
    console.error('[CSV Import] Erro na importação:', err);
    progressStatus.innerText = `Erro na importação: ${err.message}`;
    showToast(`Erro ao importar CSV: ${err.message}`, true);
  } finally {
    renderSummaryAndStats();
  }
}

function setupCsvDropzone() {
  const dropzone = document.getElementById('csv-dropzone');
  const fileInput = document.getElementById('csv-file-input');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handleCsvFile(file);
  });

  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleCsvFile(file);
  });
}

function initCsvImporter() {
  setupCsvDropzone();
}

Object.assign(window, {
  downloadCsvTemplate,
  toggleCsvPastePanel,
  parsePastedCsv,
  clearCsvImport,
  handleCsvDelimiterChange,
  handleCsvMappingChange,
  handleCsvFilterChange,
  toggleSelectAllCsvRows,
  toggleCsvRowSelection,
  changeCsvPreviewPage,
  importSelectedCsvLeads,
  refreshCsvDuplicatePreview: () => {
    if (csvState.headers.length === 0) return;
    evaluateCsvRows({ resetSelection: false });
    renderSummaryAndStats();
    renderPreviewTable();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCsvImporter);
} else {
  initCsvImporter();
}
