// URL Base da API do Backend
const API_BASE = 'http://localhost:3000/api';

// Estado da Aplicação
let state = {
  searchResults: [],
  crmLeads: [],
  settings: {
    sellerName: 'Agência Web Express',
    whatsapp: '5511999999999',
    apiKey: '',
    vercelUrl: ''
  },
  currentLead: null
};

// Inicialização da Página
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadCrmLeads();
  setupDragAndDrop();
});

// ----------------------------------------------------
// GERENCIAMENTO DE ABAS E MODAIS
// ----------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById(tabId).classList.add('active');
  
  // Achar o botão da aba e adicionar active
  if (tabId === 'analyzer-tab') {
    document.querySelector("button[onclick*='analyzer-tab']").classList.add('active');
  } else {
    document.querySelector("button[onclick*='crm-tab']").classList.add('active');
    loadCrmLeads(); // Recarregar leads ao ir para a aba do CRM
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.add('active');

  if (modalId === 'settings-modal') {
    document.getElementById('config-seller-name').value = state.settings.sellerName;
    document.getElementById('config-whatsapp').value = state.settings.whatsapp;
    document.getElementById('config-api-key').value = state.settings.apiKey;
    document.getElementById('config-vercel-url').value = state.settings.vercelUrl || '';
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
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
// LOCAL STORAGE - CONFIGURAÇÕES
// ----------------------------------------------------
function loadSettings() {
  const saved = localStorage.getItem('maps_analyzer_settings');
  if (saved) {
    state.settings = JSON.parse(saved);
  }
  
  // Carregar contador de API
  const apiCount = localStorage.getItem('google_maps_api_monthly_count') || '0';
  document.getElementById('api-counter-badge').innerText = apiCount;
}

function incrementApiCounter() {
  let count = parseInt(localStorage.getItem('google_maps_api_monthly_count') || '0');
  count++;
  localStorage.setItem('google_maps_api_monthly_count', count.toString());
  document.getElementById('api-counter-badge').innerText = count;

  if (count >= 900) {
    showToast('Atenção: Você está próximo do limite gratuito de 1.000 requisições do Google Maps!', true);
  }
}

function saveSettings(event) {
  event.preventDefault();
  state.settings.sellerName = document.getElementById('config-seller-name').value.trim();
  state.settings.whatsapp = document.getElementById('config-whatsapp').value.trim().replace(/\D/g, '');
  state.settings.apiKey = document.getElementById('config-api-key').value.trim();
  state.settings.vercelUrl = document.getElementById('config-vercel-url').value.trim();

  localStorage.setItem('maps_analyzer_settings', JSON.stringify(state.settings));
  closeModal('settings-modal');
  showToast('Configurações salvas com sucesso!');
}

// ----------------------------------------------------
// BUSCA E ANÁLISE DE EMPRESAS (GOOGLE MAPS)
// ----------------------------------------------------
async function handleSearch(event) {
  event.preventDefault();
  
  const query = document.getElementById('search-query').value.trim();
  const useSimulation = document.getElementById('use-simulation').checked;
  const isSweep = document.getElementById('fortaleza-sweep').checked;
  const submitBtn = document.getElementById('search-submit-btn');

  if (!query) return;

  submitBtn.disabled = true;
  
  if (isSweep) {
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Varrendo...';
    await executeFortalezaSweep(query, useSimulation);
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
    return;
  }

  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando...';

  try {
    const results = await fetchSingleQuery(query, useSimulation);
    state.searchResults = results;
    renderSearchResults(useSimulation ? 'simulation' : 'google_places_api');
    showToast(`Busca finalizada! ${state.searchResults.length} empresas analisadas.`);
  } catch (error) {
    console.error('Erro na busca:', error);
    showToast('Falha na busca. Tente usar o modo de simulação.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
  }
}

// Helper para fazer uma única busca
async function fetchSingleQuery(queryText, useSimulation) {
  let url = `${API_BASE}/search?query=${encodeURIComponent(queryText)}`;
  if (useSimulation || !state.settings.apiKey) {
    url += `&simulate=true`;
  }

  const headers = {};
  if (state.settings.apiKey) {
    headers['x-google-api-key'] = state.settings.apiKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Erro do Servidor: ${response.status}`);
  }

  const data = await response.json();
  
  // Incrementar contador se for requisição real
  if (data.source === 'google_places_api') {
    incrementApiCounter();
  }

  return data.results || [];
}

// Função para varrer os bairros de Fortaleza de forma otimizada
async function executeFortalezaSweep(query, useSimulation) {
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

  let allResults = [];

  for (let i = 0; i < neighborhoods.length; i++) {
    const neighborhood = neighborhoods[i];
    statusText.innerText = `Buscando "${query}" no bairro ${neighborhood}...`;
    
    try {
      // Ajusta o termo de busca para focar no bairro e cidade
      const fullQuery = `${query} no bairro ${neighborhood}, Fortaleza, CE`;
      const results = await fetchSingleQuery(fullQuery, useSimulation);
      
      allResults.push(...results);
      
      // Contar leads sem site encontrados até agora
      const currentLeadsNoSite = allResults.filter(p => !p.website || p.website === '').length;
      leadsCountText.innerText = `${currentLeadsNoSite} leads sem site encontrados`;
    } catch (err) {
      console.error(`Erro ao buscar no bairro ${neighborhood}:`, err);
    }

    // Atualizar progresso
    const percent = Math.round(((i + 1) / neighborhoods.length) * 100);
    progressBar.style.width = `${percent}%`;
    percentText.innerText = `${percent}%`;

    // Pequena pausa entre requisições para evitar gargalos na API
    if (i < neighborhoods.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Filtrar duplicados pelo place_id
  const uniqueResultsMap = new Map();
  allResults.forEach(item => {
    uniqueResultsMap.set(item.place_id, item);
  });
  
  // Converter de volta para array
  let consolidatedResults = Array.from(uniqueResultsMap.values());

  // Ordenar para colocar os sem website primeiro
  consolidatedResults.sort((a, b) => {
    const hasA = a.website ? 1 : 0;
    const hasB = b.website ? 1 : 0;
    return hasA - hasB; // coloca os 0 (sem site) antes dos 1 (com site)
  });

  state.searchResults = consolidatedResults;
  renderSearchResults(useSimulation ? 'simulation' : 'google_places_api');
  
  statusText.innerText = 'Varredura concluída!';
  showToast(`Varredura finalizada! ${consolidatedResults.length} empresas consolidadas.`);
  
  // Esconder a barra de progresso após 3 segundos
  setTimeout(() => {
    progressContainer.style.display = 'none';
  }, 3500);
}

function renderSearchResults(source) {
  const resultsSection = document.getElementById('search-results-section');
  const resultsGrid = document.getElementById('results-grid');
  const resultsCount = document.getElementById('results-count');
  const sourceInfo = document.getElementById('results-source-info');

  resultsGrid.innerHTML = '';
  resultsCount.innerText = state.searchResults.length;
  sourceInfo.innerText = source === 'simulation' ? 'Fonte: Simulador (Sem custo de API)' : 'Fonte: Google Maps Live API';
  resultsSection.style.display = 'block';

  state.searchResults.forEach(place => {
    const card = document.createElement('div');
    card.className = `search-card ${place.website ? 'has-website' : 'no-website'}`;

    // Verificar se já está no CRM
    const isAlreadyLead = state.crmLeads.some(lead => lead.place_id === place.place_id);

    // Avaliação do Maps
    let ratingStars = '';
    if (place.rating) {
      ratingStars = `
        <span class="rating-stars">
          ${place.rating} <i class="fa-solid fa-star"></i>
          <span class="rating-count">(${place.user_ratings_total})</span>
        </span>
      `;
    } else {
      ratingStars = `<span class="rating-count" style="color: var(--text-dimmed)">Sem avaliações</span>`;
    }

    card.innerHTML = `
      <div>
        <div class="card-header">
          <div class="card-title">${place.name}</div>
          <span class="badge ${place.website ? 'badge-has-site' : 'badge-no-site'}">
            ${place.website ? 'Com Website' : 'Sem Website'}
          </span>
        </div>
        
        <div class="card-body">
          <div class="info-item">
            <i class="fa-solid fa-location-dot"></i>
            <span>${place.address}</span>
          </div>
          <div class="info-item">
            <i class="fa-solid fa-phone"></i>
            <span>${place.phone || 'Telefone Indisponível'}</span>
          </div>
          <div class="info-item">
            <i class="fa-solid fa-star"></i>
            <span>${ratingStars}</span>
          </div>
          <div class="info-item">
            <i class="fa-solid fa-tags"></i>
            <span>${place.category || 'Categoria não definida'}</span>
          </div>
        </div>
      </div>

      <div class="card-footer">
        ${place.website ? `
          <a href="${place.website}" target="_blank" class="card-btn btn-secondary" style="text-decoration:none;">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Ver Site
          </a>
        ` : `
          <button 
            onclick="importToCrm('${place.place_id}')" 
            class="card-btn btn-primary" 
            id="import-btn-${place.place_id}"
            ${isAlreadyLead ? 'disabled' : ''}
          >
            <i class="fa-solid ${isAlreadyLead ? 'fa-check-double' : 'fa-plus'}"></i> 
            ${isAlreadyLead ? 'Importado' : 'Importar CRM'}
          </button>
        `}
      </div>
    `;

    resultsGrid.appendChild(card);
  });
}

async function importToCrm(placeId) {
  const place = state.searchResults.find(p => p.place_id === placeId);
  if (!place) return;

  const btn = document.getElementById(`import-btn-${placeId}`);
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const response = await fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place_id: place.place_id,
        name: place.name,
        phone: place.phone,
        address: place.address,
        rating: place.rating,
        user_ratings_total: place.user_ratings_total,
        category: place.category,
        latitude: place.latitude,
        longitude: place.longitude,
        status: 'novo',
        notes: `Criado a partir da busca no Maps em ${new Date().toLocaleDateString('pt-BR')}.`
      })
    });

    if (!response.ok) throw new Error('Erro ao salvar no banco');

    const newLead = await response.json();
    state.crmLeads.push(newLead);
    
    // Atualizar visual do botão
    btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Importado';
    btn.disabled = true;

    showToast(`"${place.name}" importada com sucesso para o CRM!`);
  } catch (error) {
    console.error('Erro ao importar para o CRM:', error);
    showToast('Erro ao importar lead', true);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-plus"></i> Importar CRM';
  }
}

// ----------------------------------------------------
// PIPELINE CRM (KANBAN)
// ----------------------------------------------------
async function loadCrmLeads() {
  try {
    const response = await fetch(`${API_BASE}/leads`);
    if (!response.ok) throw new Error('Falha ao obter leads');
    
    state.crmLeads = await response.json();
    renderKanban();
  } catch (error) {
    console.error('Erro ao carregar CRM:', error);
    showToast('Erro ao atualizar funil do CRM', true);
  }
}

function renderKanban() {
  const statuses = ['novo', 'contactado', 'negociacao', 'proposta', 'ganho', 'perdido'];
  
  // Limpar todos os containers e badges
  statuses.forEach(status => {
    document.getElementById(`container-${status}`).innerHTML = '';
    document.getElementById(`count-${status}`).innerText = '0';
  });

  document.getElementById('total-leads-badge').innerText = state.crmLeads.length;

  const counts = { novo: 0, contactado: 0, negociacao: 0, proposta: 0, ganho: 0, perdido: 0 };

  state.crmLeads.forEach(lead => {
    const status = lead.status || 'novo';
    if (!statuses.includes(status)) return;

    counts[status]++;
    const container = document.getElementById(`container-${status}`);

    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', lead.id);
    
    // Contruir conteúdo do card
    card.innerHTML = `
      <div class="kanban-card-title">${lead.name}</div>
      <div class="kanban-card-info">
        <i class="fa-solid fa-tags"></i> <span>${lead.category || 'Negócio'}</span>
      </div>
      <div class="kanban-card-info">
        <i class="fa-solid fa-phone"></i> <span>${lead.phone || 'Sem Telefone'}</span>
      </div>
      
      <div class="kanban-card-actions">
        <div class="actions-group">
          <!-- Botão Notas -->
          <button class="icon-btn" onclick="openLeadModal(${lead.id})" title="Ver Detalhes & Notas">
            <i class="fa-regular fa-comment-dots"></i>
          </button>
          
          <!-- Botão WhatsApp -->
          <button class="icon-btn btn-whatsapp-action" onclick="openWhatsappPitch(${lead.id})" title="Enviar Pitch WhatsApp">
            <i class="fa-brands fa-whatsapp"></i>
          </button>
          
          <!-- Botão Visualizar Proposta -->
          <a href="${getProposalLink(lead)}" target="_blank" class="icon-btn" title="Ver Link Proposta" style="text-decoration:none;">
            <i class="fa-solid fa-file-invoice"></i>
          </a>
        </div>
        
        <div class="actions-group">
          <!-- Mover para a esquerda se possível -->
          ${status !== 'novo' ? `
            <button class="icon-btn" onclick="shiftLead(${lead.id}, -1)" title="Mover Anterior">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
          ` : ''}
          
          <!-- Mover para a direita se possível -->
          ${status !== 'perdido' ? `
            <button class="icon-btn btn-move-right" onclick="shiftLead(${lead.id}, 1)" title="Mover Próximo">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          ` : ''}

          <!-- Deletar Lead do CRM -->
          <button class="icon-btn" onclick="confirmDeleteLead(${lead.id})" title="Deletar do CRM" style="background: rgba(239, 68, 68, 0.1); color: var(--accent-red)">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;

    // Listeners de drag
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    container.appendChild(card);
  });

  // Atualizar contadores
  statuses.forEach(status => {
    document.getElementById(`count-${status}`).innerText = counts[status];
  });
}

// Movimentador rápido de colunas por botões
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
      
      const leadId = parseInt(e.dataTransfer.getData('text/plain'));
      const newStatus = container.parentElement.getAttribute('data-status');
      
      if (!isNaN(leadId) && newStatus) {
        updateLeadStatusOnServer(leadId, newStatus);
      }
    });
  });
}

async function updateLeadStatusOnServer(leadId, newStatus) {
  try {
    const response = await fetch(`${API_BASE}/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!response.ok) throw new Error('Falha ao atualizar status');

    const updatedLead = await response.json();
    
    // Atualizar estado local
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
// POPUP DE ANOTAÇÕES DO LEAD
// ----------------------------------------------------
function openLeadModal(leadId) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead) return;

  state.currentLead = lead;
  
  document.getElementById('lead-modal-id').value = lead.id;
  document.getElementById('lead-modal-title').innerText = lead.name;
  
  let detailsHtml = `
    <p><strong>Categoria:</strong> ${lead.category || 'Não definida'}</p>
    <p><strong>Telefone:</strong> ${lead.phone || 'Não informado'}</p>
    <p><strong>Endereço:</strong> ${lead.address || 'Não informado'}</p>
    <p><strong>Avaliação no Maps:</strong> ${lead.rating || 0} ⭐ (${lead.user_ratings_total || 0} avaliações)</p>
    <p><strong>Data de Captação:</strong> ${new Date(lead.created_at).toLocaleString('pt-BR')}</p>
  `;
  document.getElementById('lead-modal-details').innerHTML = detailsHtml;
  document.getElementById('lead-modal-notes').value = lead.notes || '';
  
  openModal('lead-modal');
}

async function saveLeadNotes(event) {
  event.preventDefault();
  
  const leadId = parseInt(document.getElementById('lead-modal-id').value);
  const notes = document.getElementById('lead-modal-notes').value.trim();

  try {
    const response = await fetch(`${API_BASE}/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });

    if (!response.ok) throw new Error('Falha ao salvar anotações');

    const updatedLead = await response.json();
    
    // Atualizar no estado local
    const idx = state.crmLeads.findIndex(l => l.id === leadId);
    if (idx !== -1) {
      state.crmLeads[idx] = updatedLead;
    }

    closeModal('lead-modal');
    showToast('Anotações salvas!');
  } catch (error) {
    console.error(error);
    showToast('Erro ao salvar anotações', true);
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
      const response = await fetch(`${API_BASE}/leads/${leadId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Erro ao deletar lead');

      state.crmLeads = state.crmLeads.filter(l => l.id !== leadId);
      renderKanban();
      showToast('Lead removido do funil!');
    } catch (error) {
      console.error(error);
      showToast('Erro ao remover lead', true);
    }
  }
}

// Helper para decidir o link de proposta (Local vs Vercel estático)
function getProposalLink(lead) {
  if (state.settings.vercelUrl) {
    const baseUrl = state.settings.vercelUrl.replace(/\/+$/, '');
    return `${baseUrl}/proposal.html?name=${encodeURIComponent(lead.name)}&category=${encodeURIComponent(lead.category || '')}&phone=${encodeURIComponent(lead.phone || '')}&address=${encodeURIComponent(lead.address || '')}&rating=${lead.rating || 0}&reviews=${lead.user_ratings_total || 0}`;
  }
  return `http://localhost:3000/proposal.html?id=${lead.id}`;
}

// ----------------------------------------------------
// WHATSAPP PITCH GENERATION
// ----------------------------------------------------
function openWhatsappPitch(leadId) {
  const lead = state.crmLeads.find(l => l.id === leadId);
  if (!lead) return;

  if (!lead.phone || lead.phone.toLowerCase().includes('sem') || lead.phone === '') {
    showToast('Esta empresa não possui telefone cadastrado para contato!', true);
    return;
  }

  // Sanitizar o número de telefone da empresa
  let cleanPhone = lead.phone.replace(/\D/g, '');
  
  // Garantir que comece com o código do país
  if (cleanPhone.length === 10 || cleanPhone.length === 11) {
    // Adiciona o prefixo do Brasil se for de tamanho comum
    cleanPhone = '55' + cleanPhone;
  }

  const proposalLink = getProposalLink(lead);
  
  // Script de copywriting personalizado de acordo com o status atual
  let text = '';
  
  if (lead.status === 'novo') {
    text = `Olá! Falo com o responsável ou proprietário da *${lead.name}*?
    
Vi o perfil de vocês no Google Maps com excelentes avaliações de clientes (${lead.rating} estrelas)! Notei que vocês ainda não possuem um site profissional cadastrado lá.
    
Hoje em dia, cerca de 70% das pessoas procuram o site de uma empresa local no Maps antes de comprar para passar mais confiança.
    
Criei uma demonstração visual gratuita e exclusiva de como ficaria um site premium para a *${lead.name}* no celular e computador. 

Você pode ver a proposta e a demonstração nesse link:
👉 ${proposalLink}
    
Se gostar, podemos conversar para colocá-lo no ar com o seu domínio próprio. O que acha?`;
  } else {
    text = `Olá! Passando para compartilhar a proposta oficial de desenvolvimento do site profissional da *${lead.name}*.
    
Preparei um painel interativo com o modelo do site e os detalhes comerciais. Você pode acessar por este link seguro:
👉 ${proposalLink}
    
Fico à disposição para tirar qualquer dúvida e iniciar o projeto!
    
Atenciosamente,
*${state.settings.sellerName}*`;
  }

  // URL de envio do WhatsApp
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
  
  // Registrar contato nas anotações do lead
  const noteLog = `\n[Sistema] Abordagem feita via WhatsApp em ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}.`;
  
  // Fazer requisição silenciosa no backend para anexar nota
  fetch(`${API_BASE}/leads/${lead.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      status: lead.status === 'novo' ? 'contactado' : lead.status,
      notes: (lead.notes || '') + noteLog 
    })
  }).then(() => {
    // Recarregar leads em segundo plano
    loadCrmLeads();
  });

  // Abrir WhatsApp
  window.open(whatsappUrl, '_blank');
}
