// Estado da Aplicação
let state = {
  printQueue: [],
  extractedLeads: [],
  searchResults: [],
  lastSearchSource: 'simulation',
  crmLeads: [],
  serverCapabilities: {
    online: false,
    hasEnvGeminiKey: false,
    hasEnvOpenAiKey: false,
    hasEnvPlacesKey: false,
    defaultGeminiModel: 'gemini-flash-latest'
  },
  settings: {
    sellerName: 'Agência Web Express',
    whatsapp: '5511999999999',
    apiKey: '',
    vercelUrl: '',
    backendUrl: window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:3000',
    waToken: '',
    waPhoneId: '',
    waTemplate: 'hello_world',
    waLang: 'pt_BR',
    aiProvider: 'gemini',
    aiApiKey: '',
    aiModel: 'gemini-flash-latest',
    defaultCity: ''
  },
  currentLead: null,
  quickPitch: {
    queueType: 'novo',
    items: [],
    currentIndex: 0
  },
  searchPagination: {
    currentPage: 1,
    itemsPerPage: 10
  },
  filters: {
    searchCategory: 'all',
    searchRating: 'all',
    searchOnlyNoSite: true,
    searchOnlyWithContact: false,
    crmSearch: '',
    crmSource: 'all',
    crmCategory: 'all',
    crmRating: 'all'
  }
};

// Retorna a URL Base da API dinamicamente a partir das configurações
const getApiBase = () => {
  const defaultOrigin = window.location.protocol.startsWith('http')
    ? window.location.origin
    : 'http://localhost:3000';
  const backendUrl = state.settings.backendUrl || defaultOrigin;
  return backendUrl.replace(/\/+$/, '') + '/api';
};

// ----------------------------------------------------
// UTILITÁRIOS DE SEGURANÇA, TELEFONE E DADOS
// ----------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function parseJsonSafe(val, fallback = []) {
  if (Array.isArray(val)) return val;
  if (!val || typeof val !== 'string') return fallback;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeInstagramHandle(handle) {
  if (!handle || typeof handle !== 'string') return '';
  let clean = handle.trim().toLowerCase();
  if (!clean) return '';
  clean = clean
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .split(/[/?#]/)[0]
    .replace(/^@+/, '')
    .trim();
  return clean ? `@${clean}` : '';
}

function getInstagramUrl(handle) {
  const normalized = normalizeInstagramHandle(handle);
  if (!normalized) return '';
  return `https://www.instagram.com/${normalized.replace(/^@/, '')}/`;
}

function classifyBrPhone(rawPhone) {
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

function sanitizeWhatsappPhone(rawPhone) {
  let digits = (rawPhone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }
  return digits;
}

function getPhoneBadgeHtml(phone) {
  const type = classifyBrPhone(phone);
  if (type === 'celular') {
    return '<span class="badge badge-phone-mobile"><i class="fa-brands fa-whatsapp"></i> Celular</span>';
  }
  if (type === 'fixo') {
    return '<span class="badge badge-phone-landline"><i class="fa-solid fa-phone"></i> Fixo</span>';
  }
  return '<span class="badge badge-phone-missing"><i class="fa-solid fa-triangle-exclamation"></i> Sem Tel</span>';
}

function isLeadFollowupDue(lead) {
  if (!lead || lead.status !== 'contactado') return false;
  const refDate = lead.last_contacted_at || lead.created_at;
  if (!refDate) return false;
  const ts = new Date(refDate).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts >= 48 * 60 * 60 * 1000;
}

// ----------------------------------------------------
// INICIALIZAÇÃO DA PÁGINA
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  checkLoginStatus();
  setupPrintCaptureListeners();
  setupDragAndDrop();

  await checkBackendHealth();
  await loadCrmLeads();
  loadLastSearch();
});

// ----------------------------------------------------
// HEALTH CHECK E LOGIN
// ----------------------------------------------------
async function checkBackendHealth() {
  const badge = document.getElementById('backend-status-badge');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(`${getApiBase()}/health`, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error('Health not ok');
    const data = await response.json();
    state.serverCapabilities = {
      online: true,
      hasEnvGeminiKey: Boolean(data.hasEnvGeminiKey),
      hasEnvOpenAiKey: Boolean(data.hasEnvOpenAiKey),
      hasEnvPlacesKey: Boolean(data.hasEnvPlacesKey),
      defaultGeminiModel: data.defaultGeminiModel || 'gemini-flash-latest'
    };

    badge.className = 'status-pill online';
    badge.innerHTML = '<span class="status-dot"></span><span>Backend Online</span>';
  } catch {
    state.serverCapabilities.online = false;
    badge.className = 'status-pill offline';
    badge.innerHTML = '<span class="status-dot"></span><span>Backend Offline</span>';
  }

  updateAiKeyWarning();
}

function hasConfiguredAiKey() {
  if (state.settings.aiApiKey && state.settings.aiApiKey.trim()) return true;
  if (state.settings.aiProvider === 'openai') return state.serverCapabilities.hasEnvOpenAiKey;
  return state.serverCapabilities.hasEnvGeminiKey;
}

function updateAiKeyWarning() {
  const warning = document.getElementById('ai-key-warning');
  if (!warning) return;
  warning.style.display = hasConfiguredAiKey() ? 'none' : 'flex';
}

function checkLoginStatus() {
  const loggedIn = localStorage.getItem('crm_logged_in') === 'true';
  const loginGate = document.getElementById('login-gate');
  loginGate.style.display = loggedIn ? 'none' : 'flex';
}

async function handleLogin(event) {
  event.preventDefault();
  const passwordInput = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');

  try {
    const response = await fetch(`${getApiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput })
    });

    if (response.ok) {
      localStorage.setItem('crm_logged_in', 'true');
      document.getElementById('login-gate').style.display = 'none';
      errorDiv.style.display = 'none';
      showToast('Bem-vindo ao Painel!');
      await checkBackendHealth();
      await loadCrmLeads();
      return;
    }

    errorDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Senha incorreta. Tente novamente.';
    errorDiv.style.display = 'block';
    document.getElementById('login-password').value = '';
  } catch {
    errorDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Não foi possível conectar ao servidor backend. Inicie o servidor com npm start e verifique a URL.';
    errorDiv.style.display = 'block';
  }
}

// ----------------------------------------------------
// GERENCIAMENTO DE ABAS E MODAIS
// ----------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  const activeBtn = document.querySelector(`button[onclick*="'${tabId}'"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (tabId === 'crm-tab') {
    loadCrmLeads();
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.add('active');

  if (modalId === 'settings-modal') {
    document.getElementById('config-ai-provider').value = state.settings.aiProvider || 'gemini';
    document.getElementById('config-ai-api-key').value = state.settings.aiApiKey || '';
    document.getElementById('config-ai-model').value =
      state.settings.aiModel || (state.settings.aiProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-latest');
    document.getElementById('config-default-city').value = state.settings.defaultCity || '';

    document.getElementById('config-seller-name').value = state.settings.sellerName || '';
    document.getElementById('config-whatsapp').value = state.settings.whatsapp || '';
    document.getElementById('config-api-key').value = state.settings.apiKey || '';
    document.getElementById('config-vercel-url').value = state.settings.vercelUrl || '';
    document.getElementById('config-backend-url').value =
      state.settings.backendUrl || (window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:3000');
    document.getElementById('config-wa-token').value = state.settings.waToken || '';
    document.getElementById('config-wa-phone-id').value = state.settings.waPhoneId || '';
    document.getElementById('config-wa-template').value = state.settings.waTemplate || 'hello_world';
    document.getElementById('config-wa-lang').value = state.settings.waLang || 'pt_BR';
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function handleAiProviderChange() {
  const provider = document.getElementById('config-ai-provider').value;
  const modelInput = document.getElementById('config-ai-model');
  if (provider === 'openai') {
    if (!modelInput.value || modelInput.value.startsWith('gemini')) {
      modelInput.value = 'gpt-4o-mini';
    }
    modelInput.placeholder = 'gpt-4o-mini';
  } else {
    if (!modelInput.value || modelInput.value.startsWith('gpt')) {
      modelInput.value = 'gemini-flash-latest';
    }
    modelInput.placeholder = 'gemini-flash-latest';
  }
}

// Toast Notifications
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const icon = toast.querySelector('i');

  if (isError) {
    icon.className = 'fa-solid fa-circle-exclamation';
    icon.style.color = 'var(--accent-red)';
    toast.style.borderLeftColor = 'var(--accent-red)';
  } else {
    icon.className = 'fa-solid fa-circle-check';
    icon.style.color = 'var(--accent-green)';
    toast.style.borderLeftColor = 'var(--accent-purple)';
  }

  document.getElementById('toast-message').innerText = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// ----------------------------------------------------
// LOCAL STORAGE - CONFIGURAÇÕES & CONTADOR MENSAL
// ----------------------------------------------------
function getMonthlyApiCountKey() {
  const monthPrefix = new Date().toISOString().slice(0, 7);
  return `google_maps_api_count_${monthPrefix}`;
}

function loadSettings() {
  const saved = localStorage.getItem('maps_analyzer_settings');
  if (saved) {
    try {
      state.settings = { ...state.settings, ...JSON.parse(saved) };
      const legacyGeminiModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];
      if (state.settings.aiProvider !== 'openai' && legacyGeminiModels.includes(state.settings.aiModel)) {
        state.settings.aiModel = 'gemini-flash-latest';
        localStorage.setItem('maps_analyzer_settings', JSON.stringify(state.settings));
      }
    } catch {
      // mantém defaults
    }
  }

  const apiCount = localStorage.getItem(getMonthlyApiCountKey()) || '0';
  document.getElementById('api-counter-badge').innerText = apiCount;
}

function incrementApiCounter() {
  const key = getMonthlyApiCountKey();
  let count = parseInt(localStorage.getItem(key) || '0', 10);
  count++;
  localStorage.setItem(key, count.toString());
  document.getElementById('api-counter-badge').innerText = count;

  if (count >= 900) {
    showToast('Atenção: Você está próximo do limite gratuito de 1.000 requisições do Google Maps este mês!', true);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const provider = document.getElementById('config-ai-provider').value;
  state.settings.aiProvider = provider;
  state.settings.aiApiKey = document.getElementById('config-ai-api-key').value.trim();
  state.settings.aiModel =
    document.getElementById('config-ai-model').value.trim() ||
    (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-latest');
  state.settings.defaultCity = document.getElementById('config-default-city').value.trim();

  state.settings.sellerName = document.getElementById('config-seller-name').value.trim();
  state.settings.whatsapp = document.getElementById('config-whatsapp').value.trim().replace(/\D/g, '');
  state.settings.apiKey = document.getElementById('config-api-key').value.trim();
  state.settings.vercelUrl = document.getElementById('config-vercel-url').value.trim();
  state.settings.backendUrl =
    document.getElementById('config-backend-url').value.trim() ||
    (window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:3000');
  state.settings.waToken = document.getElementById('config-wa-token').value.trim();
  state.settings.waPhoneId = document.getElementById('config-wa-phone-id').value.trim();
  state.settings.waTemplate = document.getElementById('config-wa-template').value.trim() || 'hello_world';
  state.settings.waLang = document.getElementById('config-wa-lang').value.trim() || 'pt_BR';

  localStorage.setItem('maps_analyzer_settings', JSON.stringify(state.settings));
  closeModal('settings-modal');
  showToast('Configurações salvas com sucesso!');

  await checkBackendHealth();
  await loadCrmLeads();
}

// ----------------------------------------------------
// CAPTURA E EXTRAÇÃO POR PRINTS (FLUXO PRINCIPAL)
// ----------------------------------------------------
function setupPrintCaptureListeners() {
  const dropzone = document.getElementById('print-dropzone');
  const fileInput = document.getElementById('print-file-input');

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await addFilesToPrintQueue(files);
    }
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', async e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      await addFilesToPrintQueue(files);
    } else {
      showToast('Solte apenas arquivos de imagem (PNG, JPG, WebP).', true);
    }
  });

  document.addEventListener('paste', handleGlobalPaste);
}

async function handleGlobalPaste(e) {
  const printsTab = document.getElementById('prints-tab');
  if (!printsTab || !printsTab.classList.contains('active')) return;

  const items = Array.from(e.clipboardData?.items || []);
  const imageFiles = items
    .filter(item => item.type && item.type.startsWith('image/'))
    .map((item, idx) => {
      const file = item.getAsFile();
      if (!file) return null;
      return new File([file], file.name || `print-colado-${Date.now()}-${idx + 1}.png`, { type: file.type });
    })
    .filter(Boolean);

  if (imageFiles.length === 0) return;

  e.preventDefault();
  await addFilesToPrintQueue(imageFiles);
  showToast(`${imageFiles.length} print(s) colado(s) na fila!`);
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida ou corrompida.'));
      img.onload = () => {
        const maxWidth = 1280;
        const maxHeight = 2200;
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addFilesToPrintQueue(files) {
  const availableSlots = 15 - state.printQueue.length;
  if (availableSlots <= 0) {
    showToast('Limite de 15 prints na fila atingido. Analise ou limpe antes de adicionar mais.', true);
    return;
  }

  const batch = files.slice(0, availableSlots);
  for (const file of batch) {
    try {
      const dataUrl = await compressImageFile(file);
      state.printQueue.push({
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        filename: file.name || 'print.jpg',
        dataUrl,
        status: 'Pronto'
      });
    } catch (err) {
      console.error('Erro ao comprimir print:', err);
      showToast(`Não foi possível ler "${file.name || 'imagem'}".`, true);
    }
  }

  renderPrintQueue();
}

function removeFromPrintQueue(id) {
  state.printQueue = state.printQueue.filter(item => item.id !== id);
  renderPrintQueue();
}

function clearPrintQueue() {
  state.printQueue = [];
  renderPrintQueue();
}

function renderPrintQueue() {
  const grid = document.getElementById('print-queue-grid');
  if (state.printQueue.length === 0) {
    grid.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  grid.style.display = 'grid';
  grid.innerHTML = state.printQueue
    .map(
      item => `
      <div class="print-thumb">
        <img src="${escapeAttr(item.dataUrl)}" alt="${escapeAttr(item.filename)}">
        <button type="button" class="print-thumb-remove" data-queue-id="${escapeAttr(item.id)}" onclick="removeFromPrintQueue(this.dataset.queueId)" title="Remover print">&times;</button>
        <div class="print-thumb-status">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.filename)}</span>
          <span style="color: var(--accent-blue); font-weight:600;">${escapeHtml(item.status)}</span>
        </div>
      </div>
    `
    )
    .join('');
}

async function analyzePrintQueue() {
  if (state.printQueue.length === 0) {
    showToast('Cole (Ctrl+V) ou envie pelo menos 1 print antes de analisar.', true);
    return;
  }

  if (!hasConfiguredAiKey()) {
    showToast('Configure sua chave gratuita do Google Gemini nas Configurações primeiro!', true);
    openModal('settings-modal');
    return;
  }

  const analyzeBtn = document.getElementById('analyze-prints-btn');
  const progressBox = document.getElementById('print-progress-container');
  const progressBar = document.getElementById('print-progress-bar');
  const progressStatus = document.getElementById('print-progress-status');
  const progressPercent = document.getElementById('print-progress-percent');

  const mode = document.getElementById('print-mode').value;
  const autoImport = document.getElementById('print-auto-import').checked;

  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analisando...';

  progressBox.style.display = 'block';
  progressBar.style.width = '25%';
  progressPercent.innerText = '25%';
  progressStatus.innerText = `Enviando ${state.printQueue.length} print(s) para leitura com IA...`;

  state.printQueue.forEach(item => {
    item.status = 'Lendo...';
  });
  renderPrintQueue();

  try {
    const response = await fetch(`${getApiBase()}/extract-from-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: state.printQueue.map(item => ({
          dataUrl: item.dataUrl,
          filename: item.filename
        })),
        mode,
        provider: state.settings.aiProvider || 'gemini',
        apiKey: state.settings.aiApiKey || '',
        model: state.settings.aiModel || '',
        defaultCity: state.settings.defaultCity || ''
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Erro do servidor (${response.status})`);
    }

    progressBar.style.width = '85%';
    progressPercent.innerText = '85%';
    progressStatus.innerText = 'Estruturando empresas e verificando duplicados...';

    const extracted = (data.businesses || []).map((biz, idx) => ({
      ...biz,
      _localId: `ext_${Date.now()}_${idx}`
    }));

    state.extractedLeads = [...extracted, ...state.extractedLeads];

    state.printQueue.forEach(item => {
      item.status = 'Lido';
    });
    renderPrintQueue();

    if (Array.isArray(data.errors) && data.errors.length > 0) {
      showToast(`Alguns prints falharam (${data.errors.length}): ${data.errors[0].error}`, true);
    }

    if (autoImport && extracted.length > 0) {
      const eligible = extracted.filter(b => !b.has_website && !b.already_in_crm);
      if (eligible.length > 0) {
        await importExtractedLeadsBatch(eligible, true);
      } else {
        renderExtractedLeads();
        showToast(`${extracted.length} empresa(s) extraída(s)! Nenhuma nova elegível para auto-importação.`);
      }
    } else {
      renderExtractedLeads();
      showToast(`${extracted.length} empresa(s) extraída(s) dos prints!`);
    }

    progressBar.style.width = '100%';
    progressPercent.innerText = '100%';
    progressStatus.innerText = `Concluído! ${extracted.length} empresa(s) extraída(s).`;
    setTimeout(() => {
      progressBox.style.display = 'none';
    }, 2500);
  } catch (err) {
    console.error('Erro na análise de prints:', err);
    showToast(err.message || 'Erro ao analisar prints.', true);
    progressBox.style.display = 'none';
    state.printQueue.forEach(item => {
      item.status = 'Erro';
    });
    renderPrintQueue();
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analisar Prints com IA';
  }
}

function loadDemoInstagramPrint() {
  const now = Date.now();
  const demoLeads = [
    {
      _localId: `ext_demo_1_${now}`,
      place_id: `print_ig_studiobellapele_${now}`,
      name: 'Studio Bella Pele Estética',
      source: 'instagram',
      instagram: '@studiobellapele.for',
      followers: '12,4 mil seguidores',
      category: 'Clínica de Estética',
      phone: '(85) 99812-4432',
      phone_type: 'celular',
      address: 'Aldeota, Fortaleza - CE',
      opening_hours: 'Seg a Sáb: 09:00 às 19:00',
      rating: 0,
      user_ratings_total: 0,
      has_website: false,
      website: '',
      bio_link: 'https://wa.me/5585998124432',
      bio: 'Especialistas em limpeza de pele, microagulhamento e harmonização facial em Aldeota. Agende sua avaliação no link!',
      services: [
        { title: 'Limpeza de Pele Profunda', desc: 'Renovação celular completa com extração segura e hidratação.' },
        { title: 'Microagulhamento Facial', desc: 'Estímulo natural de colágeno para pele firme e uniforme.' },
        { title: 'Harmonização & Toxina', desc: 'Protocolos personalizados com acompanhamento especializado.' }
      ],
      reviews_sample: [],
      brand_color: '#db2777',
      confidence: 'alta',
      notes_ai: 'Exemplo de perfil do Instagram com link direto para WhatsApp na bio (sem site próprio).',
      already_in_crm: false,
      existing_lead_id: null
    },
    {
      _localId: `ext_demo_2_${now}`,
      place_id: `print_ig_precisaoauto_${now}`,
      name: 'Precisão Auto Estética & Mecânica',
      source: 'instagram',
      instagram: '@precisaoauto.ce',
      followers: '5.890 seguidores',
      category: 'Oficina Mecânica',
      phone: '(85) 98744-1190',
      phone_type: 'celular',
      address: 'Meireles, Fortaleza - CE',
      opening_hours: 'Seg a Sex: 08:00 às 18:00',
      rating: 0,
      user_ratings_total: 0,
      has_website: false,
      website: '',
      bio_link: 'https://linktr.ee/precisaoautoce',
      bio: 'Revisão computadorizada, estética automotiva e higienização interna no Meireles. Orçamentos pelo Linktree.',
      services: [
        { title: 'Revisão Computadorizada', desc: 'Diagnóstico preciso de motor, freios e injeção eletrônica.' },
        { title: 'Estética Automotiva', desc: 'Polimento técnico e vitrificação com proteção duradoura.' },
        { title: 'Higienização & Ar', desc: 'Limpeza completa do sistema de ar-condicionado e estofados.' }
      ],
      reviews_sample: [],
      brand_color: '#0284c7',
      confidence: 'alta',
      notes_ai: 'Exemplo de perfil do Instagram usando apenas Linktree na bio.',
      already_in_crm: false,
      existing_lead_id: null
    }
  ];

  state.extractedLeads = [...demoLeads, ...state.extractedLeads];
  renderExtractedLeads();
  showToast('2 exemplos de lojas do Instagram carregados! Edite, veja a proposta ou importe no CRM.');
}

function renderExtractedLeads() {
  const section = document.getElementById('extracted-results-section');
  const grid = document.getElementById('extracted-results-grid');
  const countEl = document.getElementById('extracted-count');

  if (state.extractedLeads.length === 0) {
    section.style.display = 'none';
    grid.innerHTML = '';
    countEl.innerText = '0';
    return;
  }

  section.style.display = 'block';
  countEl.innerText = state.extractedLeads.length;
  grid.innerHTML = '';

  state.extractedLeads.forEach(item => {
    const existingLead =
      state.crmLeads.find(l => l.id === item.existing_lead_id || (item.place_id && l.place_id === item.place_id)) ||
      null;
    const isImported = Boolean(existingLead || item.already_in_crm);
    if (existingLead && !item.existing_lead_id) {
      item.existing_lead_id = existingLead.id;
    }

    const card = document.createElement('div');
    card.className = `search-card extracted-card ${item.has_website ? 'has-website' : 'no-website'}`;

    const isInstagram = item.source === 'instagram' || Boolean(item.instagram);
    const sourceBadge = isInstagram
      ? `<span class="badge badge-instagram"><i class="fa-brands fa-instagram"></i> ${escapeHtml(item.instagram || 'Instagram')}</span>`
      : `<span class="badge badge-maps"><i class="fa-solid fa-map-pin"></i> ${escapeHtml(item.source || 'Maps')}</span>`;

    const siteBadge = item.has_website
      ? '<span class="badge badge-has-site">Tem Site Próprio</span>'
      : item.bio_link
      ? '<span class="badge badge-no-site">Só Link na Bio</span>'
      : '<span class="badge badge-no-site">Sem Website</span>';

    const phoneBadge = getPhoneBadgeHtml(item.phone);
    const dupBadge = isImported ? '<span class="badge badge-duplicate">Já no CRM</span>' : '';

    const servicesChips = (Array.isArray(item.services) ? item.services : [])
      .map(s => `<span class="service-chip">${escapeHtml(s.title)}</span>`)
      .join('');

    const proposalPreviewUrl = getProposalLink(existingLead || item, { preview: true });

    card.innerHTML = `
      <div>
        <div class="extracted-badges-row">
          ${sourceBadge}
          ${siteBadge}
          ${phoneBadge}
          ${dupBadge}
        </div>

        <div class="inline-edit-grid">
          <div class="inline-edit-field full">
            <label>Nome da Empresa</label>
            <input type="text" class="inline-edit-input" value="${escapeAttr(item.name)}" data-local-id="${escapeAttr(item._localId)}" data-field="name" onchange="handleExtractedFieldChange(this)">
          </div>

          <div class="inline-edit-field">
            <label>WhatsApp / Telefone</label>
            <input type="text" class="inline-edit-input" value="${escapeAttr(item.phone || '')}" placeholder="(85) 99999-9999" data-local-id="${escapeAttr(item._localId)}" data-field="phone" onchange="handleExtractedFieldChange(this)">
          </div>

          <div class="inline-edit-field">
            <label>Instagram</label>
            <input type="text" class="inline-edit-input" value="${escapeAttr(item.instagram || '')}" placeholder="@empresa" data-local-id="${escapeAttr(item._localId)}" data-field="instagram" onchange="handleExtractedFieldChange(this)">
          </div>

          <div class="inline-edit-field">
            <label>Categoria</label>
            <input type="text" class="inline-edit-input" value="${escapeAttr(item.category || '')}" data-local-id="${escapeAttr(item._localId)}" data-field="category" onchange="handleExtractedFieldChange(this)">
          </div>

          <div class="inline-edit-field">
            <label>Endereço / Bairro</label>
            <input type="text" class="inline-edit-input" value="${escapeAttr(item.address || '')}" data-local-id="${escapeAttr(item._localId)}" data-field="address" onchange="handleExtractedFieldChange(this)">
          </div>
        </div>

        ${item.bio ? `<p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.65rem; line-height: 1.4;">${escapeHtml(item.bio)}</p>` : ''}
        ${servicesChips ? `<div class="extracted-services-list">${servicesChips}</div>` : ''}
      </div>

      <div class="card-footer-wrap">
        <button
          type="button"
          class="card-btn btn-primary"
          data-local-id="${escapeAttr(item._localId)}"
          onclick="importExtractedToCrm(this.dataset.localId)"
          ${isImported ? 'disabled' : ''}
        >
          <i class="fa-solid ${isImported ? 'fa-check-double' : 'fa-plus'}"></i>
          ${isImported ? 'No CRM' : 'Importar CRM'}
        </button>

        <a href="${escapeAttr(proposalPreviewUrl)}" target="_blank" class="card-btn btn-secondary" style="text-decoration: none;">
          <i class="fa-solid fa-mobile-screen"></i> Ver Proposta
        </a>

        <button
          type="button"
          class="card-btn btn-whatsapp"
          data-local-id="${escapeAttr(item._localId)}"
          onclick="sendExtractedWhatsapp(this.dataset.localId)"
        >
          <i class="fa-brands fa-whatsapp"></i> WhatsApp
        </button>

        ${item.instagram ? `
          <button
            type="button"
            class="card-btn btn-instagram"
            data-local-id="${escapeAttr(item._localId)}"
            onclick="sendExtractedInstagramDm(this.dataset.localId)"
          >
            <i class="fa-brands fa-instagram"></i> DM Insta
          </button>
        ` : ''}
      </div>
    `;

    grid.appendChild(card);
  });
}

async function handleExtractedFieldChange(inputEl) {
  const localId = inputEl.dataset.localId;
  const field = inputEl.dataset.field;
  const value = inputEl.value.trim();

  const item = state.extractedLeads.find(x => x._localId === localId);
  if (!item) return;

  item[field] = field === 'instagram' ? normalizeInstagramHandle(value) : value;
  if (field === 'phone') {
    item.phone_type = classifyBrPhone(value);
  }

  // Se já estiver no banco, sincronizar alteração automaticamente
  if (item.existing_lead_id) {
    try {
      const response = await fetch(`${getApiBase()}/leads/${item.existing_lead_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: item[field] })
      });
      if (response.ok) {
        const updated = await response.json();
        const idx = state.crmLeads.findIndex(l => l.id === updated.id);
        if (idx !== -1) state.crmLeads[idx] = updated;
        renderKanban();
      }
    } catch (err) {
      console.error('Erro ao sincronizar campo editado:', err);
    }
  }

  renderExtractedLeads();
}

function buildLeadPayloadFromItem(item, defaultNote) {
  return {
    place_id: item.place_id || null,
    name: item.name,
    phone: item.phone || '',
    address: item.address || '',
    rating: Number(item.rating) || 0,
    user_ratings_total: parseInt(item.user_ratings_total, 10) || 0,
    category: item.category || 'Negócio Local',
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    instagram: item.instagram || '',
    followers: item.followers || '',
    bio: item.bio || '',
    services: item.services || [],
    opening_hours: item.opening_hours || '',
    website: item.website || '',
    bio_link: item.bio_link || '',
    brand_color: item.brand_color || '',
    source: item.source || (item.instagram ? 'instagram' : 'google_maps'),
    reviews_sample: item.reviews_sample || [],
    status: 'novo',
    notes: defaultNote
  };
}

async function importExtractedToCrm(localId) {
  const item = state.extractedLeads.find(x => x._localId === localId);
  if (!item) return null;

  try {
    const note = `[Print IA] Capturado via ${item.source || 'print'} em ${new Date().toLocaleDateString('pt-BR')}.${item.notes_ai ? ' ' + item.notes_ai : ''}`;
    const response = await fetch(`${getApiBase()}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLeadPayloadFromItem(item, note))
    });

    if (!response.ok) throw new Error('Erro ao salvar lead no CRM.');

    const savedLead = await response.json();
    item.already_in_crm = true;
    item.existing_lead_id = savedLead.id;

    const existsLocally = state.crmLeads.some(l => l.id === savedLead.id);
    if (!existsLocally) {
      state.crmLeads.unshift(savedLead);
    }

    renderExtractedLeads();
    renderKanban();

    showToast(savedLead.duplicate ? `"${savedLead.name}" já estava no CRM!` : `"${savedLead.name}" importada para o CRM!`);
    return savedLead;
  } catch (err) {
    console.error('Erro ao importar extraído:', err);
    showToast('Erro ao importar empresa para o CRM.', true);
    return null;
  }
}

async function importExtractedLeadsBatch(items, isAuto = false) {
  if (!items || items.length === 0) return;

  try {
    const payloads = items.map(item =>
      buildLeadPayloadFromItem(
        item,
        `[Print IA] Importado em lote em ${new Date().toLocaleDateString('pt-BR')}.${item.notes_ai ? ' ' + item.notes_ai : ''}`
      )
    );

    const response = await fetch(`${getApiBase()}/leads/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: payloads })
    });

    if (!response.ok) throw new Error('Falha na importação em lote.');
    const data = await response.json();
    const imported = data.imported || [];

    imported.forEach(saved => {
      const match = state.extractedLeads.find(
        x => (saved.place_id && x.place_id === saved.place_id) || x.name.toLowerCase() === (saved.name || '').toLowerCase()
      );
      if (match) {
        match.already_in_crm = true;
        match.existing_lead_id = saved.id;
      }
      if (!state.crmLeads.some(l => l.id === saved.id)) {
        state.crmLeads.unshift(saved);
      }
    });

    (data.skipped || []).forEach(skip => {
      if (skip.reason === 'duplicate' && skip.existingId) {
        const match = state.extractedLeads.find(x => x.name.toLowerCase() === (skip.name || '').toLowerCase());
        if (match) {
          match.already_in_crm = true;
          match.existing_lead_id = skip.existingId;
        }
      }
    });

    renderExtractedLeads();
    renderKanban();

    const skippedCount = (data.skipped || []).length;
    showToast(
      isAuto
        ? `${imported.length} empresa(s) sem site importada(s) automaticamente!${skippedCount ? ` (${skippedCount} já no CRM)` : ''}`
        : `Importação concluída: ${imported.length} nova(s), ${skippedCount} ignorada(s)/duplicada(s).`
    );
  } catch (err) {
    console.error('Erro no lote de extraídos:', err);
    showToast('Erro ao importar empresas em lote.', true);
    renderExtractedLeads();
  }
}

async function importAllExtractedToCrm() {
  const eligible = state.extractedLeads.filter(b => !b.has_website && !b.already_in_crm);
  if (eligible.length === 0) {
    showToast('Nenhuma nova empresa sem site elegível na lista!', true);
    return;
  }
  await importExtractedLeadsBatch(eligible, false);
}

async function sendExtractedWhatsapp(localId) {
  const item = state.extractedLeads.find(x => x._localId === localId);
  if (!item) return;

  if (!item.existing_lead_id) {
    const saved = await importExtractedToCrm(localId);
    if (!saved) return;
  }

  await openWhatsappPitch(item.existing_lead_id);
}

async function sendExtractedInstagramDm(localId) {
  const item = state.extractedLeads.find(x => x._localId === localId);
  if (!item) return;

  if (!item.existing_lead_id) {
    const saved = await importExtractedToCrm(localId);
    if (!saved) return;
  }

  await openInstagramDm(item.existing_lead_id);
}

// ----------------------------------------------------
// BUSCA E ANÁLISE DE EMPRESAS (OPENSTREETMAP / GOOGLE MAPS)
// ----------------------------------------------------
const FORTALEZA_NICHES = [
  'loja de roupas Fortaleza',
  'clinica odontologica Fortaleza',
  'salao de beleza Fortaleza',
  'barbearia Fortaleza',
  'oficina mecanica Fortaleza',
  'pet shop Fortaleza',
  'pizzaria Fortaleza',
  'restaurante Fortaleza',
  'padaria Fortaleza',
  'academia Fortaleza',
  'estetica Fortaleza',
  'otica Fortaleza'
];

async function handleSearch(event) {
  event.preventDefault();

  const query = document.getElementById('search-query').value.trim();
  const searchMode = document.getElementById('search-source').value;
  const isSweep = document.getElementById('fortaleza-sweep').checked;
  const submitBtn = document.getElementById('search-submit-btn');

  if (!query) return;

  state.searchPagination.currentPage = 1;
  submitBtn.disabled = true;

  if (isSweep) {
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Varrendo...';
    await executeFortalezaSweep(query, searchMode);
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
    return;
  }

  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando...';

  try {
    const city = query.toLowerCase().includes('fortaleza') ? 'fortaleza' : '';
    const { source, results } = await fetchSingleQuery(query, searchMode, { city });
    state.searchResults = results;
    state.lastSearchSource = source;
    renderSearchResults(source);
    showToast(`Busca finalizada! ${state.searchResults.length} empresa(s) encontrada(s).`);
  } catch (error) {
    console.error('Erro na busca:', error);
    showToast(error.message || 'Falha na busca. Tente outra fonte.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
  }
}

async function quickSearchFortaleza(term) {
  const input = document.getElementById('search-query');
  const sweepCheck = document.getElementById('fortaleza-sweep');
  const submitBtn = document.getElementById('search-submit-btn');
  const searchMode = document.getElementById('search-source').value;

  input.value = term;
  if (sweepCheck) sweepCheck.checked = false;
  state.searchPagination.currentPage = 1;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando...';

  try {
    const { source, results } = await fetchSingleQuery(term, searchMode, { city: 'fortaleza' });
    state.searchResults = results;
    state.lastSearchSource = source;
    renderSearchResults(source);
    showToast(`${results.length} empresa(s) carregadas para "${term}"!`);
  } catch (error) {
    console.error('Erro no atalho Fortaleza:', error);
    showToast(error.message || 'Erro ao buscar nicho em Fortaleza.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
  }
}

async function fetchSingleQuery(queryText, mode = 'osm', { city = '' } = {}) {
  const params = new URLSearchParams({
    query: queryText,
    mode
  });
  if (city) {
    params.set('city', city);
  }

  const url = `${getApiBase()}/search?${params.toString()}`;
  const headers = {};
  if (mode === 'google' && state.settings.apiKey) {
    headers['x-google-api-key'] = state.settings.apiKey;
  }

  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Erro do Servidor: ${response.status}`);
  }

  if (data.source === 'google_places_api') {
    incrementApiCounter();
  }

  return {
    source: data.source || mode,
    results: data.results || []
  };
}

function deduplicateAndSortSearchResults(allResults) {
  const uniqueMap = new Map();

  allResults.forEach(item => {
    const fallbackKey = `${(item.name || '').toLowerCase().trim()}|${(item.address || '').toLowerCase().trim()}`;
    const key = item.place_id || fallbackKey;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  });

  const consolidated = Array.from(uniqueMap.values());
  consolidated.sort((a, b) => {
    const hasA = a.website ? 1 : 0;
    const hasB = b.website ? 1 : 0;
    if (hasA !== hasB) return hasA - hasB;

    const contactA = a.instagram || (a.phone && !a.phone.toLowerCase().includes('sem')) ? 0 : 1;
    const contactB = b.instagram || (b.phone && !b.phone.toLowerCase().includes('sem')) ? 0 : 1;
    return contactA - contactB;
  });

  return consolidated;
}

async function runFortalezaMultiNicheScan() {
  const searchMode = document.getElementById('search-source').value;
  const submitBtn = document.getElementById('search-submit-btn');
  const progressContainer = document.getElementById('sweep-progress-container');
  const progressBar = document.getElementById('sweep-progress-bar');
  const statusText = document.getElementById('sweep-status-text');
  const percentText = document.getElementById('sweep-percent-text');
  const leadsCountText = document.getElementById('sweep-leads-count');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Varrendo...';

  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  percentText.innerText = '0%';
  leadsCountText.innerText = '0 leads sem site encontrados';
  statusText.innerText = 'Iniciando lista geral de Fortaleza (vários nichos)...';

  const allResults = [];
  let effectiveSource = searchMode === 'google' ? 'google_places_api' : searchMode === 'simulation' ? 'simulation' : 'openstreetmap';
  const delayMs = searchMode === 'osm' ? 1150 : 450;

  try {
    for (let i = 0; i < FORTALEZA_NICHES.length; i++) {
      const niche = FORTALEZA_NICHES[i];
      statusText.innerText = `Buscando "${niche}" (${i + 1}/${FORTALEZA_NICHES.length})...`;

      try {
        const { source, results } = await fetchSingleQuery(niche, searchMode, { city: 'fortaleza' });
        effectiveSource = source;
        allResults.push(...results);

        const uniqueNow = deduplicateAndSortSearchResults(allResults);
        const noSiteCount = uniqueNow.filter(p => !p.website).length;
        leadsCountText.innerText = `${noSiteCount} lojas sem site encontradas`;
      } catch (err) {
        console.error(`Erro no nicho "${niche}":`, err);
        if (searchMode === 'google' && String(err.message || '').includes('Key')) {
          showToast(err.message, true);
          break;
        }
      }

      const percent = Math.round(((i + 1) / FORTALEZA_NICHES.length) * 100);
      progressBar.style.width = `${percent}%`;
      percentText.innerText = `${percent}%`;

      if (i < FORTALEZA_NICHES.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const consolidatedResults = deduplicateAndSortSearchResults(allResults);
    state.searchResults = consolidatedResults;
    state.lastSearchSource = effectiveSource;
    state.searchPagination.currentPage = 1;
    renderSearchResults(effectiveSource);

    statusText.innerText = 'Lista geral de Fortaleza concluída!';
    showToast(`Lista pronta! ${consolidatedResults.filter(p => !p.website).length} lojas sem site em Fortaleza.`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 3500);
  }
}

async function executeFortalezaSweep(query, searchMode = 'osm') {
  const neighborhoods = ['Centro', 'Aldeota', 'Meireles', 'Messejana', 'Montese', 'Parangaba', 'Fátima', 'Cocó', 'Jovita Feitosa'];
  const progressContainer = document.getElementById('sweep-progress-container');
  const progressBar = document.getElementById('sweep-progress-bar');
  const statusText = document.getElementById('sweep-status-text');
  const percentText = document.getElementById('sweep-percent-text');
  const leadsCountText = document.getElementById('sweep-leads-count');

  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  percentText.innerText = '0%';
  leadsCountText.innerText = '0 leads sem site encontrados';
  statusText.innerText = 'Iniciando varredura por bairros...';

  const allResults = [];
  let effectiveSource = searchMode === 'google' ? 'google_places_api' : searchMode === 'simulation' ? 'simulation' : 'openstreetmap';
  const delayMs = searchMode === 'osm' ? 1150 : 500;

  for (let i = 0; i < neighborhoods.length; i++) {
    const neighborhood = neighborhoods[i];
    statusText.innerText = `Buscando "${query}" no bairro ${neighborhood}...`;

    try {
      const fullQuery = `${query} ${neighborhood} Fortaleza CE`;
      const { source, results } = await fetchSingleQuery(fullQuery, searchMode, { city: 'fortaleza' });
      effectiveSource = source;
      allResults.push(...results);

      const uniqueNow = deduplicateAndSortSearchResults(allResults);
      const currentLeadsNoSite = uniqueNow.filter(p => !p.website || p.website === '').length;
      leadsCountText.innerText = `${currentLeadsNoSite} leads sem site encontrados`;
    } catch (err) {
      console.error(`Erro ao buscar no bairro ${neighborhood}:`, err);
      if (searchMode === 'google' && String(err.message || '').includes('Key')) {
        showToast(err.message, true);
        break;
      }
    }

    const percent = Math.round(((i + 1) / neighborhoods.length) * 100);
    progressBar.style.width = `${percent}%`;
    percentText.innerText = `${percent}%`;

    if (i < neighborhoods.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  const consolidatedResults = deduplicateAndSortSearchResults(allResults);
  state.searchResults = consolidatedResults;
  state.lastSearchSource = effectiveSource;
  renderSearchResults(effectiveSource);

  statusText.innerText = 'Varredura concluída!';
  showToast(`Varredura finalizada! ${consolidatedResults.length} empresas consolidadas.`);

  setTimeout(() => {
    progressContainer.style.display = 'none';
  }, 3500);
}

// Função auxiliar de correspondência de categoria/nicho
function matchCategory(placeCategory, filterValue) {
  if (filterValue === 'all') return true;

  const categoryLower = (placeCategory || '').toLowerCase();

  if (filterValue === 'clinica') {
    return (
      categoryLower.includes('clinic') ||
      categoryLower.includes('clínic') ||
      categoryLower.includes('odont') ||
      categoryLower.includes('dentis') ||
      categoryLower.includes('saud') ||
      categoryLower.includes('health') ||
      categoryLower.includes('medical') ||
      categoryLower.includes('hospital') ||
      categoryLower.includes('terapia') ||
      categoryLower.includes('médic') ||
      categoryLower.includes('estetic') ||
      categoryLower.includes('estétic')
    );
  }

  if (filterValue === 'oficina') {
    return (
      categoryLower.includes('mecanic') ||
      categoryLower.includes('mecân') ||
      categoryLower.includes('oficina') ||
      categoryLower.includes('auto') ||
      categoryLower.includes('car') ||
      categoryLower.includes('motor')
    );
  }

  if (filterValue === 'outros') {
    return !matchCategory(placeCategory, 'clinica') && !matchCategory(placeCategory, 'oficina');
  }

  // Correspondência com categoria dinâmica exata do CRM
  return categoryLower === filterValue.toLowerCase();
}

function matchRating(rating, filterValue) {
  if (filterValue === 'all') return true;
  const r = parseFloat(rating) || 0;
  if (filterValue === 'high') return r >= 4.0;
  if (filterValue === 'low') return r > 0 && r < 4.0;
  if (filterValue === 'none') return r === 0;
  return true;
}

function handleSearchFilterChange() {
  state.filters.searchOnlyNoSite = document.getElementById('search-only-no-site').checked;
  state.filters.searchOnlyWithContact = document.getElementById('search-only-with-contact').checked;
  state.searchPagination.currentPage = 1;
  renderSearchResults(state.lastSearchSource);
}

function handleSearchCategoryChange() {
  state.filters.searchCategory = document.getElementById('search-category-filter').value;
  state.searchPagination.currentPage = 1;
  renderSearchResults(state.lastSearchSource);
}

function handleSearchRatingChange() {
  state.filters.searchRating = document.getElementById('search-rating-filter').value;
  state.searchPagination.currentPage = 1;
  renderSearchResults(state.lastSearchSource);
}

function changeSearchPage(direction) {
  state.searchPagination.currentPage += direction;
  renderSearchResults(state.lastSearchSource);
}

function handleCrmSearchChange() {
  state.filters.crmSearch = document.getElementById('crm-search-input').value.trim().toLowerCase();
  renderKanban();
}

function handleCrmSourceChange() {
  state.filters.crmSource = document.getElementById('crm-source-filter').value;
  renderKanban();
}

function handleCrmCategoryChange() {
  state.filters.crmCategory = document.getElementById('crm-category-filter').value;
  renderKanban();
}

function handleCrmRatingChange() {
  state.filters.crmRating = document.getElementById('crm-rating-filter').value;
  renderKanban();
}

function loadLastSearch() {
  const saved = localStorage.getItem('maps_analyzer_last_search');
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    if (data.source === 'simulation') {
      localStorage.removeItem('maps_analyzer_last_search');
      return;
    }

    state.searchResults = data.results || [];
    state.lastSearchSource = data.source || 'openstreetmap';
    document.getElementById('search-query').value = data.query || '';

    if (data.categoryFilter) {
      state.filters.searchCategory = data.categoryFilter;
      const selectCat = document.getElementById('search-category-filter');
      if (selectCat) selectCat.value = data.categoryFilter;
    }
    if (data.ratingFilter) {
      state.filters.searchRating = data.ratingFilter;
      const selectRat = document.getElementById('search-rating-filter');
      if (selectRat) selectRat.value = data.ratingFilter;
    }

    if (state.searchResults.length > 0) {
      renderSearchResults(state.lastSearchSource);
    }
  } catch (e) {
    console.error('Erro ao carregar última busca:', e);
  }
}

function getFilteredSearchResults() {
  return state.searchResults.filter(place => {
    if (!matchCategory(place.category, state.filters.searchCategory)) return false;
    if (!matchRating(place.rating, state.filters.searchRating)) return false;
    if (state.filters.searchOnlyNoSite && place.website) return false;
    if (state.filters.searchOnlyWithContact) {
      const hasPhone = Boolean(place.phone && !place.phone.toLowerCase().includes('sem'));
      const hasInsta = Boolean(place.instagram);
      if (!hasPhone && !hasInsta) return false;
    }
    return true;
  });
}

function renderSearchResults(source) {
  const resultsSection = document.getElementById('search-results-section');
  const resultsGrid = document.getElementById('results-grid');
  const resultsCount = document.getElementById('results-count');
  const sourceInfo = document.getElementById('results-source-info');

  resultsGrid.innerHTML = '';

  if (source !== 'simulation') {
    localStorage.setItem(
      'maps_analyzer_last_search',
      JSON.stringify({
        query: document.getElementById('search-query').value.trim(),
        results: state.searchResults,
        source: source,
        categoryFilter: state.filters.searchCategory,
        ratingFilter: state.filters.searchRating
      })
    );
  } else {
    localStorage.removeItem('maps_analyzer_last_search');
  }

  const filtered = getFilteredSearchResults();
  resultsCount.innerText = filtered.length;
  if (source === 'openstreetmap' || source === 'osm') {
    sourceInfo.innerText = 'Fonte: OpenStreetMap (Real e Grátis)';
  } else if (source === 'simulation') {
    sourceInfo.innerText = 'Fonte: Simulador (Sem custo de API)';
  } else {
    sourceInfo.innerText = 'Fonte: Google Maps Live API';
  }
  resultsSection.style.display = 'block';

  const totalItems = filtered.length;
  const itemsPerPage = state.searchPagination.itemsPerPage;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  if (state.searchPagination.currentPage > totalPages) {
    state.searchPagination.currentPage = totalPages;
  }

  const startIdx = (state.searchPagination.currentPage - 1) * itemsPerPage;
  const pageItems = filtered.slice(startIdx, startIdx + itemsPerPage);

  document.getElementById('search-page-info').innerText = `Página ${state.searchPagination.currentPage} de ${totalPages}`;
  document.getElementById('search-prev-btn').disabled = state.searchPagination.currentPage <= 1;
  document.getElementById('search-next-btn').disabled = state.searchPagination.currentPage >= totalPages;

  if (pageItems.length === 0) {
    resultsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: var(--radius-md); color: var(--text-muted);">
        Nenhuma loja corresponde aos filtros selecionados. Tente desmarcar "Com Tel/Insta" ou pesquisar outro termo de Fortaleza.
      </div>
    `;
    return;
  }

  pageItems.forEach(place => {
    const card = document.createElement('div');
    card.className = `search-card ${place.website ? 'has-website' : 'no-website'}`;

    const isAlreadyLead = state.crmLeads.some(lead => lead.place_id === place.place_id);
    const phoneBadge = getPhoneBadgeHtml(place.phone);

    const ratingStars = place.rating
      ? `<span class="rating-stars">${escapeHtml(place.rating)} <i class="fa-solid fa-star"></i> <span class="rating-count">(${escapeHtml(place.user_ratings_total)})</span></span>`
      : `<span class="rating-count" style="color: var(--text-dimmed)">Sem avaliações</span>`;

    const instaSearchUrl =
      place.instagram_search_url ||
      (place.instagram
        ? getInstagramUrl(place.instagram)
        : `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com "${place.name}" Fortaleza`)}`);

    const mapsUrl =
      place.google_maps_uri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${place.address || 'Fortaleza CE'}`)}`;

    card.innerHTML = `
      <div>
        <div class="card-header">
          <div class="card-title">${escapeHtml(place.name)}</div>
          <div style="display:flex; gap:0.35rem; flex-wrap:wrap; justify-content:flex-end;">
            ${phoneBadge}
            <span class="badge ${place.website ? 'badge-has-site' : 'badge-no-site'}">
              ${place.website ? 'Com Website' : place.bio_link ? 'Só Link Bio' : 'Sem Website'}
            </span>
          </div>
        </div>

        <div class="card-body">
          <div class="info-item">
            <i class="fa-solid fa-location-dot"></i>
            <span>${escapeHtml(place.address)}</span>
          </div>
          <div class="info-item">
            <i class="fa-solid fa-phone"></i>
            <span>${escapeHtml(place.phone || 'Telefone Indisponível')}</span>
          </div>
          ${
            place.instagram
              ? `<div class="info-item">
                  <i class="fa-brands fa-instagram" style="color: #f472b6;"></i>
                  <span>${escapeHtml(place.instagram)}</span>
                </div>`
              : ''
          }
          <div class="info-item">
            <i class="fa-solid fa-star"></i>
            <span>${ratingStars}</span>
          </div>
          <div class="info-item">
            <i class="fa-solid fa-tags"></i>
            <span>${escapeHtml(place.category || 'Categoria não definida')}</span>
          </div>
        </div>
      </div>

      <div class="card-footer-wrap">
        ${
          place.website
            ? `
          <a href="${escapeAttr(place.website)}" target="_blank" class="card-btn btn-secondary" style="text-decoration:none;">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Ver Site
          </a>
        `
            : `
          <button
            type="button"
            data-place-id="${escapeAttr(place.place_id)}"
            onclick="importToCrm(this.dataset.placeId, this)"
            class="card-btn btn-primary"
            ${isAlreadyLead ? 'disabled' : ''}
          >
            <i class="fa-solid ${isAlreadyLead ? 'fa-check-double' : 'fa-plus'}"></i>
            ${isAlreadyLead ? 'Importado' : 'Importar CRM'}
          </button>
        `
        }
        <a href="${escapeAttr(instaSearchUrl)}" target="_blank" class="card-btn btn-instagram" style="text-decoration:none;" title="Buscar perfil no Instagram para tirar print">
          <i class="fa-brands fa-instagram"></i> ${place.instagram ? 'Ver Insta' : 'Buscar Insta'}
        </a>
        <a href="${escapeAttr(mapsUrl)}" target="_blank" class="card-btn btn-secondary" style="text-decoration:none;" title="Abrir localização no Google Maps">
          <i class="fa-solid fa-map-location-dot"></i> Maps
        </a>
      </div>
    `;

    resultsGrid.appendChild(card);
  });
}

function csvEscapeCell(value) {
  const str = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (/[;"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportSearchResultsCsv() {
  const filtered = getFilteredSearchResults();
  if (filtered.length === 0) {
    showToast('Não há resultados visíveis para exportar.', true);
    return;
  }

  const headers = [
    'Nome',
    'Categoria',
    'Telefone',
    'Tipo Telefone',
    'Instagram',
    'Endereço',
    'Horário',
    'Avaliação',
    'Tem Site',
    'Link Instagram',
    'Link Google Maps'
  ];

  const rows = filtered.map(place => {
    const instaUrl =
      place.instagram_search_url ||
      (place.instagram
        ? getInstagramUrl(place.instagram)
        : `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com "${place.name}" Fortaleza`)}`);
    const mapsUrl =
      place.google_maps_uri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${place.address || 'Fortaleza CE'}`)}`;

    return [
      place.name || '',
      place.category || '',
      place.phone || '',
      classifyBrPhone(place.phone),
      place.instagram || '',
      place.address || '',
      place.opening_hours || '',
      place.rating || 0,
      place.website ? 'Sim' : 'Não',
      instaUrl,
      mapsUrl
    ]
      .map(csvEscapeCell)
      .join(';');
  });

  const csvContent = '\uFEFF' + [headers.map(csvEscapeCell).join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `lojas-fortaleza-sem-site-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`${filtered.length} loja(s) exportada(s) em CSV!`);
}

async function importToCrm(placeId, btnElement = null) {
  const place = state.searchResults.find(p => p.place_id === placeId);
  if (!place) return;

  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }

  try {
    const response = await fetch(`${getApiBase()}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildLeadPayloadFromItem(
          { ...place, source: place.source || 'google_maps' },
          `Criado a partir da busca (${place.source || 'maps'}) em ${new Date().toLocaleDateString('pt-BR')}.`
        )
      )
    });

    if (!response.ok) throw new Error('Erro ao salvar no banco');

    const newLead = await response.json();
    if (!state.crmLeads.some(l => l.id === newLead.id)) {
      state.crmLeads.unshift(newLead);
    }

    if (btnElement) {
      btnElement.innerHTML = '<i class="fa-solid fa-check-double"></i> Importado';
      btnElement.disabled = true;
    }

    renderKanban();
    showToast(
      newLead.duplicate
        ? `"${place.name}" já estava cadastrada no CRM.`
        : `"${place.name}" importada com sucesso para o CRM!`
    );
  } catch (error) {
    console.error('Erro ao importar para o CRM:', error);
    showToast('Erro ao importar lead', true);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = '<i class="fa-solid fa-plus"></i> Importar CRM';
    }
  }
}

async function importBulkToCrm() {
  const matching = getFilteredSearchResults();

  const eligibleLeads = matching.filter(place => {
    const isAlreadyLead = state.crmLeads.some(lead => lead.place_id === place.place_id);
    const hasNoWebsite = !place.website || place.website === '';
    return hasNoWebsite && !isAlreadyLead;
  });

  if (eligibleLeads.length === 0) {
    showToast('Nenhuma nova empresa sem site elegível para importação em massa!', true);
    return;
  }

  if (!confirm(`Deseja importar todas as ${eligibleLeads.length} empresas do filtro selecionado para o CRM?`)) {
    return;
  }

  const bulkBtn = document.getElementById('import-bulk-btn');
  const originalHtml = bulkBtn.innerHTML;
  bulkBtn.disabled = true;
  bulkBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Importando ${eligibleLeads.length}...`;

  try {
    const payloads = eligibleLeads.map(place =>
      buildLeadPayloadFromItem(
        { ...place, source: place.source || 'google_maps' },
        `Importado em massa a partir do painel em ${new Date().toLocaleDateString('pt-BR')}.`
      )
    );

    const response = await fetch(`${getApiBase()}/leads/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: payloads })
    });

    if (!response.ok) throw new Error('Falha na importação em lote.');
    const data = await response.json();

    await loadCrmLeads();
    renderSearchResults(state.lastSearchSource);

    showToast(
      `Importação em massa finalizada! Novas: ${(data.imported || []).length}. Duplicadas/Ignoradas: ${(data.skipped || []).length}.`
    );
  } catch (err) {
    console.error('[Bulk Import] Falha:', err);
    showToast('Erro na importação em massa.', true);
  } finally {
    bulkBtn.disabled = false;
    bulkBtn.innerHTML = originalHtml;
  }
}

// ----------------------------------------------------
// PIPELINE CRM (KANBAN)
// ----------------------------------------------------
async function loadCrmLeads() {
  try {
    const response = await fetch(`${getApiBase()}/leads`);
    if (!response.ok) throw new Error('Falha ao obter leads');

    state.crmLeads = await response.json();
    populateCrmCategoryFilter();
    renderKanban();
    if (typeof window.refreshCsvDuplicatePreview === 'function') {
      window.refreshCsvDuplicatePreview();
    }
  } catch (error) {
    console.error('Erro ao carregar CRM:', error);
    showToast('Erro ao atualizar funil do CRM', true);
  }
}

function populateCrmCategoryFilter() {
  const select = document.getElementById('crm-category-filter');
  if (!select) return;

  const currentVal = state.filters.crmCategory || 'all';
  const uniqueCategories = Array.from(
    new Set(
      state.crmLeads
        .map(l => (l.category || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  select.innerHTML = `
    <option value="all">Todas as Categorias</option>
    <option value="clinica">Clínicas / Saúde</option>
    <option value="oficina">Oficinas / Mecânicas</option>
    <option value="outros">Outros</option>
    ${uniqueCategories.map(cat => `<option value="${escapeAttr(cat)}">${escapeHtml(cat)}</option>`).join('')}
  `;

  const hasCurrent = Array.from(select.options).some(opt => opt.value === currentVal);
  select.value = hasCurrent ? currentVal : 'all';
  state.filters.crmCategory = select.value;
}

function matchCrmSearch(lead, searchTerm) {
  if (!searchTerm) return true;
  const hay = [
    lead.name,
    lead.instagram,
    lead.phone,
    lead.address,
    lead.category
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(searchTerm);
}

function matchCrmSource(lead, sourceFilter) {
  if (sourceFilter === 'all') return true;
  if (sourceFilter === 'csv') return lead.source === 'csv';
  const isIg = lead.source === 'instagram' || Boolean(lead.instagram);
  if (sourceFilter === 'instagram') return isIg;
  if (sourceFilter === 'google_maps') {
    return (
      lead.source === 'google_maps' ||
      lead.source === 'openstreetmap' ||
      (!lead.source && !lead.instagram)
    );
  }
  return true;
}

function renderKanban() {
  const statuses = ['novo', 'contactado', 'negociacao', 'proposta', 'ganho', 'perdido'];

  statuses.forEach(status => {
    document.getElementById(`container-${status}`).innerHTML = '';
    document.getElementById(`count-${status}`).innerText = '0';
  });

  const filteredLeads = state.crmLeads.filter(
    lead =>
      matchCrmSearch(lead, state.filters.crmSearch) &&
      matchCrmSource(lead, state.filters.crmSource) &&
      matchCategory(lead.category, state.filters.crmCategory) &&
      matchRating(lead.rating, state.filters.crmRating)
  );

  document.getElementById('total-leads-badge').innerText = filteredLeads.length;

  const counts = { novo: 0, contactado: 0, negociacao: 0, proposta: 0, ganho: 0, perdido: 0 };

  filteredLeads.forEach(lead => {
    const status = lead.status || 'novo';
    if (!statuses.includes(status)) return;

    counts[status]++;
    const container = document.getElementById(`container-${status}`);

    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', lead.id);

    const isInstagram = lead.source === 'instagram' || Boolean(lead.instagram);
    const phoneType = classifyBrPhone(lead.phone);
    const followupDue = isLeadFollowupDue(lead);
    const viewsCount = parseInt(lead.proposal_views, 10) || 0;

    const previewProposalUrl = getProposalLink(lead, { preview: true });

    card.innerHTML = `
      <div class="crm-meta-row">
        ${
          lead.source === 'csv'
            ? `<span class="crm-mini-badge badge-source-csv"><i class="fa-solid fa-file-csv"></i> CSV</span>`
            : ''
        }
        ${
          isInstagram
            ? `<span class="crm-mini-badge badge-source-ig"><i class="fa-brands fa-instagram"></i> ${escapeHtml(lead.instagram || 'Insta')}</span>`
            : lead.source === 'csv'
            ? ''
            : `<span class="crm-mini-badge" style="background: rgba(56,189,248,0.14); color: var(--accent-blue);"><i class="fa-solid fa-map-pin"></i> Maps</span>`
        }
        ${
          phoneType === 'celular'
            ? '<span class="crm-mini-badge" style="background: rgba(34,197,94,0.16); color: #4ade80;">Celular</span>'
            : phoneType === 'fixo'
            ? '<span class="crm-mini-badge" style="background: rgba(245,158,11,0.18); color: var(--accent-orange);">Fixo</span>'
            : '<span class="crm-mini-badge" style="background: rgba(239,68,68,0.16); color: #f87171;">Sem Tel</span>'
        }
        ${viewsCount > 0 ? `<span class="crm-mini-badge badge-viewed" title="Visto pelo cliente"><i class="fa-solid fa-eye"></i> Viu ${viewsCount}x</span>` : ''}
        ${followupDue ? '<span class="crm-mini-badge badge-followup"><i class="fa-solid fa-clock"></i> +48h</span>' : ''}
      </div>

      <div class="kanban-card-title">${escapeHtml(lead.name)}</div>
      <div class="kanban-card-info">
        <i class="fa-solid fa-tags"></i> <span>${escapeHtml(lead.category || 'Negócio')}</span>
      </div>
      <div class="kanban-card-info">
        <i class="fa-solid fa-phone"></i> <span>${escapeHtml(lead.phone || 'Sem Telefone')}</span>
      </div>

      <div class="kanban-card-actions">
        <div class="actions-group">
          <button type="button" class="icon-btn" onclick="openLeadModal(${lead.id})" title="Editar &amp; Anotações">
            <i class="fa-regular fa-comment-dots"></i>
          </button>

          <button type="button" class="icon-btn btn-whatsapp-action" onclick="openWhatsappPitch(${lead.id})" title="Enviar Pitch WhatsApp">
            <i class="fa-brands fa-whatsapp"></i>
          </button>

          ${
            lead.instagram
              ? `<button type="button" class="icon-btn" onclick="openInstagramDm(${lead.id})" title="Copiar DM &amp; Abrir Instagram" style="color: #f472b6;">
                  <i class="fa-brands fa-instagram"></i>
                </button>`
              : ''
          }

          <a href="${escapeAttr(previewProposalUrl)}" target="_blank" class="icon-btn" title="Prévia da Proposta (Vendedor)" style="text-decoration:none;">
            <i class="fa-solid fa-file-invoice"></i>
          </a>

          <button type="button" class="icon-btn" onclick="copyLeadProposalLink(${lead.id})" title="Copiar Link da Proposta (Cliente)">
            <i class="fa-regular fa-copy"></i>
          </button>
        </div>

        <div class="actions-group">
          ${
            status !== 'novo'
              ? `<button type="button" class="icon-btn" onclick="shiftLead(${lead.id}, -1)" title="Mover Anterior">
                  <i class="fa-solid fa-chevron-left"></i>
                </button>`
              : ''
          }

          ${
            status !== 'perdido'
              ? `<button type="button" class="icon-btn btn-move-right" onclick="shiftLead(${lead.id}, 1)" title="Mover Próximo">
                  <i class="fa-solid fa-chevron-right"></i>
                </button>`
              : ''
          }

          <button type="button" class="icon-btn" onclick="confirmDeleteLead(${lead.id})" title="Deletar do CRM" style="background: rgba(239, 68, 68, 0.1); color: var(--accent-red)">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;

    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    container.appendChild(card);
  });

  statuses.forEach(status => {
    document.getElementById(`count-${status}`).innerText = counts[status];
  });
}

function shiftLead(leadId, direction) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead) return;

  const statuses = ['novo', 'contactado', 'negociacao', 'proposta', 'ganho', 'perdido'];
  const currentIndex = statuses.indexOf(lead.status);
  const newIndex = currentIndex + direction;

  if (newIndex >= 0 && newIndex < statuses.length) {
    updateLeadStatusOnServer(leadId, statuses[newIndex]);
  }
}

// ----------------------------------------------------
// DRAG AND DROP LÓGICA
// ----------------------------------------------------
let draggedCard = null;

function handleDragStart(e) {
  draggedCard = this;
  this.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
}

function handleDragEnd() {
  if (draggedCard) {
    draggedCard.style.opacity = '1';
  }
  draggedCard = null;
}

function setupDragAndDrop() {
  const containers = document.querySelectorAll('.kanban-cards-container');

  containers.forEach(container => {
    container.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.style.background = 'rgba(255, 255, 255, 0.02)';
    });

    container.addEventListener('dragleave', () => {
      container.style.background = 'transparent';
    });

    container.addEventListener('drop', async e => {
      e.preventDefault();
      container.style.background = 'transparent';

      const leadId = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const newStatus = container.parentElement.getAttribute('data-status');

      if (!Number.isNaN(leadId) && newStatus) {
        updateLeadStatusOnServer(leadId, newStatus);
      }
    });
  });
}

async function updateLeadStatusOnServer(leadId, newStatus) {
  try {
    const response = await fetch(`${getApiBase()}/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!response.ok) throw new Error('Falha ao atualizar status');

    const updatedLead = await response.json();
    const idx = state.crmLeads.findIndex(l => l.id === leadId);
    if (idx !== -1) {
      state.crmLeads[idx] = updatedLead;
    }

    renderKanban();
    showToast(`Lead movido para "${newStatus.toUpperCase()}"!`);
  } catch (error) {
    console.error(error);
    showToast('Erro ao atualizar etapa do lead', true);
  }
}

// ----------------------------------------------------
// POPUP DE ANOTAÇÕES E EDIÇÃO DO LEAD
// ----------------------------------------------------
function openLeadModal(leadId) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead) return;

  state.currentLead = lead;

  document.getElementById('lead-modal-id').value = lead.id;
  document.getElementById('lead-modal-title').innerText = lead.name;

  const lastContact = lead.last_contacted_at
    ? new Date(lead.last_contacted_at).toLocaleString('pt-BR')
    : 'Ainda não contactado';
  const viewedInfo = lead.proposal_views
    ? `${lead.proposal_views}x (última em ${lead.proposal_viewed_at ? new Date(lead.proposal_viewed_at).toLocaleString('pt-BR') : '-'})`
    : 'Ainda não visualizada';

  document.getElementById('lead-modal-details').innerHTML = `
    <p><strong>Origem:</strong> ${escapeHtml(lead.source === 'instagram' ? 'Instagram' : 'Google Maps')}${lead.followers ? ` • ${escapeHtml(lead.followers)}` : ''}</p>
    <p><strong>Avaliação Maps:</strong> ${lead.rating ? `${escapeHtml(lead.rating)} ⭐ (${escapeHtml(lead.user_ratings_total || 0)} avaliações)` : 'Não aplicável / Sem avaliações'}</p>
    ${lead.bio_link ? `<p><strong>Link na Bio:</strong> <a href="${escapeAttr(lead.bio_link)}" target="_blank" style="color: var(--accent-blue);">${escapeHtml(lead.bio_link)}</a></p>` : ''}
    <p><strong>Visualizações da Proposta:</strong> ${escapeHtml(viewedInfo)}</p>
    <p><strong>Último Contato:</strong> ${escapeHtml(lastContact)} • <strong>Captado em:</strong> ${escapeHtml(new Date(lead.created_at).toLocaleString('pt-BR'))}</p>
  `;

  document.getElementById('lead-modal-phone').value = lead.phone || '';
  document.getElementById('lead-modal-instagram').value = lead.instagram || '';
  document.getElementById('lead-modal-category').value = lead.category || '';
  document.getElementById('lead-modal-address').value = lead.address || '';
  document.getElementById('lead-modal-hours').value = lead.opening_hours || '';
  document.getElementById('lead-modal-brand-color').value = lead.brand_color || '';
  document.getElementById('lead-modal-notes').value = lead.notes || '';

  openModal('lead-modal');
}

async function saveLeadNotes(event) {
  event.preventDefault();

  const leadId = parseInt(document.getElementById('lead-modal-id').value, 10);
  const payload = {
    phone: document.getElementById('lead-modal-phone').value.trim(),
    instagram: document.getElementById('lead-modal-instagram').value.trim(),
    category: document.getElementById('lead-modal-category').value.trim(),
    address: document.getElementById('lead-modal-address').value.trim(),
    opening_hours: document.getElementById('lead-modal-hours').value.trim(),
    brand_color: document.getElementById('lead-modal-brand-color').value.trim(),
    notes: document.getElementById('lead-modal-notes').value.trim()
  };

  try {
    const response = await fetch(`${getApiBase()}/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error('Falha ao salvar alterações');

    const updatedLead = await response.json();
    const idx = state.crmLeads.findIndex(l => l.id === leadId);
    if (idx !== -1) {
      state.crmLeads[idx] = updatedLead;
    }

    populateCrmCategoryFilter();
    renderKanban();
    closeModal('lead-modal');
    showToast('Dados e anotações do lead atualizados!');
  } catch (error) {
    console.error(error);
    showToast('Erro ao salvar alterações do lead', true);
  }
}

// ----------------------------------------------------
// EXCLUSÃO DE LEAD
// ----------------------------------------------------
async function confirmDeleteLead(leadId) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead) return;

  if (confirm(`Deseja realmente remover "${lead.name}" do CRM?`)) {
    try {
      const response = await fetch(`${getApiBase()}/leads/${leadId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Erro ao deletar lead');

      state.crmLeads = state.crmLeads.filter(l => l.id !== leadId);
      populateCrmCategoryFilter();
      renderKanban();
      showToast('Lead removido do funil!');
    } catch (error) {
      console.error(error);
      showToast('Erro ao remover lead', true);
    }
  }
}

// ----------------------------------------------------
// LINKS DE PROPOSTA E COPYWRITING PERSONALIZADO
// ----------------------------------------------------
function buildCompactServicesParam(services) {
  const list = parseJsonSafe(services, []);
  if (list.length === 0) return '';
  return list
    .slice(0, 3)
    .map(s => `${(s.title || '').replace(/[|;]/g, ' ').trim()}|${(s.desc || '').replace(/[|;]/g, ' ').trim()}`)
    .join(';;');
}

function getProposalLink(lead, { preview = false } = {}) {
  const defaultOrigin = window.location.protocol.startsWith('http')
    ? window.location.origin
    : 'http://localhost:3000';
  const localBase = (state.settings.backendUrl || defaultOrigin).replace(/\/+$/, '');

  const buildParamsUrl = base => {
    const url = new URL(`${base}/proposal.html`);
    url.searchParams.set('name', lead.name || 'Empresa');
    if (lead.category) url.searchParams.set('category', lead.category);
    if (lead.phone) url.searchParams.set('phone', lead.phone);
    if (lead.address) url.searchParams.set('address', lead.address);
    if (lead.rating) url.searchParams.set('rating', String(lead.rating));
    if (lead.user_ratings_total) url.searchParams.set('reviews', String(lead.user_ratings_total));
    if (state.settings.whatsapp) url.searchParams.set('sw', state.settings.whatsapp);
    if (state.settings.sellerName) url.searchParams.set('sn', state.settings.sellerName);

    const src = lead.source || (lead.instagram ? 'instagram' : 'google_maps');
    url.searchParams.set('src', src);
    if (lead.instagram) url.searchParams.set('ig', lead.instagram);
    if (lead.followers) url.searchParams.set('fol', lead.followers);
    if (lead.brand_color) url.searchParams.set('bc', lead.brand_color);
    if (lead.opening_hours) url.searchParams.set('hrs', lead.opening_hours);
    if (lead.bio) url.searchParams.set('bio', lead.bio.slice(0, 180));
    if (lead.bio_link) url.searchParams.set('bl', lead.bio_link);

    const compactSrv = buildCompactServicesParam(lead.services);
    if (compactSrv) url.searchParams.set('srv', compactSrv);

    if (preview) url.searchParams.set('preview', '1');
    return url.toString();
  };

  if (state.settings.vercelUrl) {
    const vercelBase = state.settings.vercelUrl.replace(/\/+$/, '');
    return buildParamsUrl(vercelBase);
  }

  if (lead.id) {
    const url = new URL(`${localBase}/proposal.html`);
    url.searchParams.set('id', String(lead.id));
    if (state.settings.whatsapp) url.searchParams.set('sw', state.settings.whatsapp);
    if (state.settings.sellerName) url.searchParams.set('sn', state.settings.sellerName);
    if (preview) url.searchParams.set('preview', '1');
    return url.toString();
  }

  return buildParamsUrl(localBase);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
}

async function copyLeadProposalLink(leadId) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead) return;
  const clientLink = getProposalLink(lead, { preview: false });

  try {
    await copyTextToClipboard(clientLink);
    showToast(`Link da proposta da "${lead.name}" copiado!`);
  } catch {
    prompt('Copie o link da proposta:', clientLink);
  }
}

function isRestaurantLead(lead) {
  const hint = `${lead?.category || ''} ${lead?.name || ''} ${lead?.bio || ''}`.toLowerCase();
  return /(restaur|self[\s-]?service|churrasc|pizz|hamburg|lanche|sushi|japon|acai|açaí|padar|doceria|confeit|delivery|food|gastron|culinar|culinár|caseir|espetar|nordestin|bistr|grill|frutos do mar|cafeter|cantina|\bbar\b)/.test(
    hint
  );
}

function buildPitchMessage(lead, scriptType = 'auto') {
  const proposalLink = getProposalLink(lead, { preview: false });
  const isInstagram = lead.source === 'instagram' || (Boolean(lead.instagram) && (!lead.rating || lead.rating === 0));
  const isRestaurant = isRestaurantLead(lead);
  const rating = parseFloat(lead.rating) || 0;
  const reviewsCount = parseInt(lead.user_ratings_total, 10) || 0;
  const seller = state.settings.sellerName || 'Agência Web Express';

  if (scriptType === 'objecao_maps') {
    if (isRestaurant) {
      return `Com certeza — inclusive vocês já têm ótimas referências no Google Maps, e o Maps é ótimo para as pessoas encontrarem a *${lead.name}*!

O ponto é que hoje, sem um link próprio no botão de Site/Cardápio, quem acha vocês no Maps vê fotos misturadas e concorrentes sugeridos logo abaixo, em vez de ver os pratos organizados e clicar para pedir no WhatsApp ou reservar mesa sem taxa de aplicativo.

A página não substitui o Maps: ela transforma quem já encontra vocês lá em pedido direto. Montei essa prévia para vocês verem na prática:
👉 ${proposalLink}`;
    }

    return `Com certeza — o Google Maps já ajuda bastante as pessoas a localizarem a *${lead.name}*!

O ponto é que no próprio Maps o Google exibe vários concorrentes logo abaixo do seu perfil, e o cliente não consegue ver seus serviços organizados em detalhes para pedir orçamento em 1 clique. O site não substitui o Maps: ele fecha o cliente que o Maps já trouxe e ainda fortalece vocês nas buscas normais do Google.

Preparei uma prévia exclusiva para vocês visualizarem no celular:
👉 ${proposalLink}`;
  }

  if (scriptType === 'followup') {
    const assetLabel = isRestaurant ? 'página de cardápio e pedidos' : 'modelo de site';
    const topicHint = isRestaurant
      ? 'cardápio, pedidos no WhatsApp sem taxa de app ou planos (R$ 89,90/mês ou R$ 790,00 único)'
      : 'algum serviço ou tirar dúvidas sobre o plano mensal (R$ 89,90/mês) ou pagamento único (R$ 790,00)';
    return `Olá! Tudo bem? Passando rapidinho para saber se você conseguiu ver a ${assetLabel} que montei exclusivamente para a *${lead.name}*.

Deixei o link da demonstração aqui caso tenha ficado corrido antes:
👉 ${proposalLink}

Se quiser ajustar ${topicHint}, é só me responder aqui!`;
  }

  if (scriptType === 'instagram_dm') {
    if (isRestaurant) {
      return `Olá, pessoal da ${lead.name}! Vi o perfil ${lead.instagram || 'de vocês'} no Instagram e achei o trabalho excelente. Notei que falta uma página própria de cardápio na bio para receber pedidos e reservas direto no WhatsApp sem taxa de aplicativo. Montei uma prévia gratuita para vocês verem no celular: ${proposalLink} — se curtirem, me chamem aqui!`;
    }
    return `Olá, pessoal da ${lead.name}! Vi o perfil ${lead.instagram || 'de vocês'} no Instagram e achei o trabalho excelente. Notei que vocês ainda não têm um site próprio no link da bio para transformar seguidores e buscas do Google em orçamentos e montei uma prévia gratuita no celular: ${proposalLink} — se curtirem, me chamem aqui!`;
  }

  if (scriptType === 'unico') {
    const gapText = isRestaurant
      ? 'Percebi que vocês ainda não têm uma página própria de cardápio conectada ao Google Maps para receber pedidos e reservas direto no WhatsApp sem taxa de aplicativo.'
      : 'Percebi que vocês ainda não têm um site próprio cadastrado no Google Maps para converter quem busca vocês em orçamentos diretos no WhatsApp.';
    return `Olá, tudo bem? Aqui é da *${seller}*.

Estava analisando empresas da região e gostei muito do trabalho da *${lead.name}*. ${gapText}

Desenvolvi uma demonstração exclusiva para vocês conferirem no celular:
👉 ${proposalLink}

Entregamos tudo no ar com o domínio de vocês em até 7 dias por um valor único de *R$ 790,00* (sem mensalidades obrigatórias). Faz sentido conversarmos?`;
  }

  if (scriptType === 'restaurante' || (scriptType === 'auto' && isRestaurant && (!lead.status || lead.status === 'novo'))) {
    const ratingHighlight =
      rating >= 4.0
        ? `Vi a *${lead.name}* no Google Maps com excelentes avaliações (${rating} estrelas${reviewsCount > 0 ? ` em ${reviewsCount} opiniões` : ''})!`
        : lead.instagram
        ? `Vi o perfil da *${lead.name}* (${lead.instagram}) e o trabalho de vocês na região!`
        : `Vi a *${lead.name}* no Google Maps e gostei muito do trabalho de vocês!`;

    return `Olá! Falo com o responsável pela *${lead.name}*?

${ratingHighlight} O Maps já ajuda clientes a encontrarem vocês, mas notei que falta uma página própria no botão *Site / Cardápio* — hoje quem acha o perfil vê concorrentes logo abaixo e não consegue ver os pratos organizados ou pedir/reservar direto no WhatsApp sem taxa de aplicativo.

Criei gratuitamente uma demonstração visual de como ficaria essa página exclusiva para a *${lead.name}* no celular. Temos planos flexíveis: Mensal (R$ 89,90/mês) ou Pagamento Único (R$ 790,00).

Veja o modelo pronto no link:
👉 ${proposalLink}

Se gostar, conectamos no seu Google Maps e Instagram em poucos dias. O que acha?`;
  }

  if (scriptType === 'flexivel' || scriptType === 'auto') {
    if (isInstagram && scriptType === 'auto') {
      const bioObservation = lead.bio_link
        ? 'Notei que hoje vocês usam apenas um link direto na bio, sem um site próprio para apresentar serviços, passar mais autoridade e aparecer nas buscas do Google.'
        : 'Notei que vocês ainda não possuem um site próprio cadastrado na bio para transformar seguidores e buscas do Google em orçamentos.';

      return `Olá! Falo com o responsável pela *${lead.name}*?

Vi o perfil de vocês no Instagram (${lead.instagram || 'excelente trabalho'})! ${bioObservation}

Criei gratuitamente uma demonstração visual exclusiva de como ficaria o site profissional da *${lead.name}* no celular. Temos planos flexíveis: Mensal (R$ 89,90/mês) ou Pagamento Único (R$ 790,00).

Veja o modelo pronto no link:
👉 ${proposalLink}

Se gostar, colocamos no ar com o seu domínio próprio em poucos dias. O que acha?`;
    }

    if (lead.status && lead.status !== 'novo' && scriptType === 'auto') {
      return `Olá! Passando para compartilhar a proposta oficial de desenvolvimento da página profissional da *${lead.name}*.

Preparei um painel interativo com o diagnóstico, o modelo no celular e os detalhes comerciais:
👉 ${proposalLink}

Fico à disposição para tirar qualquer dúvida e iniciar o projeto!

Atenciosamente,
*${seller}*`;
    }

    const introMaps =
      rating >= 4.0
        ? `Vi o perfil de vocês no Google Maps com excelentes avaliações (${rating} estrelas${reviewsCount > 0 ? ` em ${reviewsCount} opiniões` : ''})! O Maps já ajuda os clientes a encontrarem vocês, mas notei que ainda não há um site próprio cadastrado lá.`
        : 'Vi o perfil da empresa no Google Maps! O Maps já ajuda os clientes a encontrarem vocês, mas notei que ainda não há um site próprio cadastrado por lá.';

    return `Olá! Falo com o responsável ou proprietário da *${lead.name}*?

${introMaps} Hoje, sem um site no botão do perfil, quem encontra vocês no Maps vê concorrentes sugeridos logo abaixo e não consegue ver seus serviços organizados para pedir orçamento em 1 clique. O site trabalha junto com o Maps para fechar mais clientes.

Criei uma demonstração visual gratuita e exclusiva de como ficaria a página da *${lead.name}* no celular e computador. Temos planos flexíveis: Mensal (R$ 89,90/mês) ou Pagamento Único (R$ 790,00).

Você pode ver o modelo e os planos no link:
👉 ${proposalLink}

Se gostar, conectamos no seu Google Maps com domínio próprio. O que acha?`;
  }

  return '';
}

// ----------------------------------------------------
// WHATSAPP PITCH & DM INSTAGRAM
// ----------------------------------------------------
async function openWhatsappPitch(leadId, customText = null) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead) return false;

  const phoneType = classifyBrPhone(lead.phone);
  if (phoneType === 'ausente' || phoneType === 'invalido') {
    showToast('Esta empresa não possui telefone válido para WhatsApp!', true);
    return false;
  }

  if (phoneType === 'fixo') {
    const proceed = confirm(
      `O número "${lead.phone}" parece ser telefone FIXO. Ele pode não ter WhatsApp Business. Deseja tentar abrir mesmo assim?`
    );
    if (!proceed) return false;
  }

  const cleanPhone = sanitizeWhatsappPhone(lead.phone);
  const proposalLink = getProposalLink(lead, { preview: false });
  const text = customText || buildPitchMessage(lead, 'auto');
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
  const nowIso = new Date().toISOString();

  // Verificar se a API Oficial está configurada (apenas quando não houver texto customizado livre)
  if (!customText && state.settings.waToken && state.settings.waPhoneId) {
    showToast('Enviando mensagem via API Oficial...');

    try {
      const response = await fetch(`${getApiBase()}/send-whatsapp-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: cleanPhone,
          type: 'template',
          templateName: state.settings.waTemplate || 'hello_world',
          languageCode: state.settings.waLang || 'pt_BR',
          variables: [lead.name, proposalLink],
          apiKey: state.settings.waToken,
          phoneNumberId: state.settings.waPhoneId
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Erro na resposta da API');
      }

      const noteLog = `[API Oficial] Mensagem enviada automaticamente em ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}.`;

      await fetch(`${getApiBase()}/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: lead.status === 'novo' ? 'contactado' : lead.status,
          last_contacted_at: nowIso,
          append_note: noteLog
        })
      });

      showToast('Mensagem automática enviada com sucesso!');
      await loadCrmLeads();
      return true;
    } catch (error) {
      console.error('[WhatsApp API] Falha no envio automático:', error);
      showToast('Falha no envio automático. Abrindo WhatsApp Web...', true);
    }
  }

  // Envio manual / Fallback (anexando nota sem apagar histórico!)
  const noteLog = `[Sistema] Abordagem iniciada via WhatsApp Web em ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}.`;

  await fetch(`${getApiBase()}/leads/${lead.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: lead.status === 'novo' ? 'contactado' : lead.status,
      last_contacted_at: nowIso,
      append_note: noteLog
    })
  });

  await loadCrmLeads();
  window.open(whatsappUrl, '_blank');
  return true;
}

async function openInstagramDm(leadId, customText = null) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead || !lead.instagram) {
    showToast('Esta empresa não possui @instagram cadastrado.', true);
    return false;
  }

  const dmText = customText || buildPitchMessage(lead, 'instagram_dm');
  const igUrl = getInstagramUrl(lead.instagram);
  const nowIso = new Date().toISOString();

  try {
    await copyTextToClipboard(dmText);
    showToast(`DM copiada! Cole no perfil ${lead.instagram}.`);
  } catch {
    showToast(`Abrindo ${lead.instagram}...`);
  }

  await fetch(`${getApiBase()}/leads/${lead.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: lead.status === 'novo' ? 'contactado' : lead.status,
      last_contacted_at: nowIso,
      append_note: `[Instagram DM] Mensagem copiada e perfil aberto em ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}.`
    })
  });

  await loadCrmLeads();
  window.open(igUrl, '_blank');
  return true;
}

// ----------------------------------------------------
// MODO DISPARO RÁPIDO
// ----------------------------------------------------
function openQuickPitchModal() {
  document.getElementById('quick-pitch-queue-type').value = 'novo';
  changeQuickPitchQueue();
  openModal('quick-pitch-modal');
}

function changeQuickPitchQueue() {
  const queueType = document.getElementById('quick-pitch-queue-type').value;
  state.quickPitch.queueType = queueType;
  state.quickPitch.currentIndex = 0;

  if (queueType === 'followup') {
    state.quickPitch.items = state.crmLeads.filter(isLeadFollowupDue);
    document.getElementById('quick-pitch-script-type').value = 'followup';
  } else {
    state.quickPitch.items = state.crmLeads.filter(l => l.status === 'novo');
    document.getElementById('quick-pitch-script-type').value = 'auto';
  }

  renderQuickPitchCurrent();
}

function renderQuickPitchCurrent() {
  const { items, currentIndex } = state.quickPitch;
  const counterEl = document.getElementById('quick-pitch-counter');
  const emptyEl = document.getElementById('quick-pitch-empty');
  const bodyEl = document.getElementById('quick-pitch-body');

  if (!items || items.length === 0 || currentIndex >= items.length) {
    counterEl.innerText = '0 de 0';
    emptyEl.style.display = 'block';
    bodyEl.style.display = 'none';
    return;
  }

  const lead = items[currentIndex];
  counterEl.innerText = `Lead ${currentIndex + 1} de ${items.length}`;
  emptyEl.style.display = 'none';
  bodyEl.style.display = 'block';

  document.getElementById('quick-pitch-lead-name').innerText = lead.name;

  const isIg = lead.source === 'instagram' || Boolean(lead.instagram);
  const phoneBadge = getPhoneBadgeHtml(lead.phone);

  document.getElementById('quick-pitch-meta').innerHTML = `
    <span>${isIg ? `📸 ${escapeHtml(lead.instagram || 'Instagram')}` : '📍 Google Maps'}</span>
    <span>• ${escapeHtml(lead.category || 'Negócio Local')}</span>
    <span>• ${escapeHtml(lead.phone || 'Sem telefone')}</span>
    ${phoneBadge}
  `;

  const previewUrl = getProposalLink(lead, { preview: true });
  document.getElementById('quick-pitch-proposal-link').href = previewUrl;

  const igBtn = document.getElementById('quick-pitch-ig-btn');
  igBtn.style.display = lead.instagram ? 'flex' : 'none';

  const phoneType = classifyBrPhone(lead.phone);
  const waBtn = document.getElementById('quick-pitch-wa-btn');
  waBtn.disabled = phoneType === 'ausente' || phoneType === 'invalido';

  updateQuickPitchMessage();
}

function updateQuickPitchMessage() {
  const { items, currentIndex } = state.quickPitch;
  if (!items || currentIndex >= items.length) return;
  const lead = items[currentIndex];
  const scriptType = document.getElementById('quick-pitch-script-type').value;
  document.getElementById('quick-pitch-text').value = buildPitchMessage(lead, scriptType);
}

async function copyQuickPitchText() {
  const text = document.getElementById('quick-pitch-text').value;
  try {
    await copyTextToClipboard(text);
    showToast('Texto copiado para a área de transferência!');
  } catch {
    showToast('Não foi possível copiar automaticamente.', true);
  }
}

async function sendQuickPitchWhatsapp() {
  const { items, currentIndex } = state.quickPitch;
  if (!items || currentIndex >= items.length) return;
  const lead = items[currentIndex];
  const customText = document.getElementById('quick-pitch-text').value;

  const sent = await openWhatsappPitch(lead.id, customText);
  if (sent) {
    state.quickPitch.items.splice(currentIndex, 1);
    renderQuickPitchCurrent();
  }
}

async function sendQuickPitchInstagramDm() {
  const { items, currentIndex } = state.quickPitch;
  if (!items || currentIndex >= items.length) return;
  const lead = items[currentIndex];
  const customText = document.getElementById('quick-pitch-text').value;

  const sent = await openInstagramDm(lead.id, customText);
  if (sent) {
    state.quickPitch.items.splice(currentIndex, 1);
    renderQuickPitchCurrent();
  }
}

function skipQuickPitch() {
  state.quickPitch.currentIndex++;
  if (state.quickPitch.currentIndex >= state.quickPitch.items.length) {
    state.quickPitch.items = [];
  }
  renderQuickPitchCurrent();
}

window.getCrmLeadsList = () => state.crmLeads;
window.getDefaultImportCity = () => state.settings.defaultCity || '';
