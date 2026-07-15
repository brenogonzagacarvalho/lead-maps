// Estado Local da Proposta
let proposalState = {
  leadName: 'Sua Empresa',
  leadCategory: 'Negócio Local',
  leadPhone: '',
  leadAddress: 'Endereço Principal',
  leadRating: 4.5,
  leadReviews: 120,
  sellerWhatsapp: '5511999999999',
  sellerName: 'Agência Web Express'
};

document.addEventListener('DOMContentLoaded', async () => {
  setGenerationDate();
  
  // Capturar parâmetros da URL
  const urlParams = new URLSearchParams(window.location.search);
  const leadId = urlParams.get('id');

  if (leadId) {
    // Buscar dados do servidor
    await loadProposalFromServer(leadId);
  } else {
    // Fallback: carregar dados de parâmetros diretos da URL se fornecidos
    loadProposalFromParams(urlParams);
  }

  // Preencher a UI com os dados consolidados
  renderProposalUI();
});

// Configura a data do dia na proposta
function setGenerationDate() {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const today = new Date().toLocaleDateString('pt-BR', options);
  document.getElementById('proposal-date').innerText = `Gerado em ${today}`;
}

// Carregar dados de proposta do banco de dados (através do Express)
async function loadProposalFromServer(id) {
  try {
    const response = await fetch(`http://localhost:3000/api/proposal-data/${id}`);
    if (!response.ok) throw new Error('Não foi possível obter os dados do lead');

    const data = await response.json();
    const lead = data.lead;

    proposalState.leadName = lead.name;
    proposalState.leadCategory = lead.category || 'Negócio Local';
    proposalState.leadPhone = lead.phone || '';
    proposalState.leadAddress = lead.address || 'Endereço Principal';
    proposalState.leadRating = lead.rating || 0;
    proposalState.leadReviews = lead.user_ratings_total || 0;
    
    // Configurações do Vendedor
    proposalState.sellerWhatsapp = data.whatsappContact || '5511999999999';
    proposalState.sellerName = data.sellerName || 'Agência Web Express';
    
    // Registrar ação de proposta visualizada nas notas de forma silenciosa
    registerViewEvent(id);
  } catch (error) {
    console.error('Erro ao conectar com servidor:', error);
    // Tenta carregar do LocalStorage de configurações do vendedor se falhar
    const savedSettings = localStorage.getItem('maps_analyzer_settings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      proposalState.sellerWhatsapp = settings.whatsapp;
      proposalState.sellerName = settings.sellerName;
    }
  }
}

// Registro de auditoria: proposta visualizada pelo cliente
function registerViewEvent(leadId) {
  const noteLog = `\n[Sistema] Proposta visualizada online pelo cliente em ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}.`;
  
  fetch(`http://localhost:3000/api/leads/${leadId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      status: 'proposta',
      notes: noteLog // O backend concatena se fizermos no app.js, mas no server.js precisamos garantir que o PUT atualize.
    })
  }).catch(err => console.log('Erro ao salvar log de visualização:', err));
}

// Fallback: carregar diretamente da URL (útil para testes rápidos ou propostas estáticas)
function loadProposalFromParams(params) {
  if (params.get('name')) proposalState.leadName = params.get('name');
  if (params.get('category')) proposalState.leadCategory = params.get('category');
  if (params.get('phone')) proposalState.leadPhone = params.get('phone');
  if (params.get('address')) proposalState.leadAddress = params.get('address');
  if (params.get('rating')) proposalState.leadRating = parseFloat(params.get('rating'));
  if (params.get('reviews')) proposalState.leadReviews = parseInt(params.get('reviews'));
  
  // Tentar carregar configurações do vendedor a partir do LocalStorage do navegador
  const savedSettings = localStorage.getItem('maps_analyzer_settings');
  if (savedSettings) {
    const settings = JSON.parse(savedSettings);
    proposalState.sellerWhatsapp = settings.whatsapp;
    proposalState.sellerName = settings.sellerName;
  }
}

// Renderizar elementos na página
function renderProposalUI() {
  // Atualizar Textos
  document.getElementById('proposal-heading').innerText = `Análise Comercial: ${proposalState.leadName}`;
  document.getElementById('proposal-subheading').innerText = `Preparamos um diagnóstico de presença no Google Maps e um conceito de site exclusivo para a ${proposalState.leadName}.`;
  
  // Nota da Auditoria (calculada dinamicamente baseada no rating e ausência de site)
  let score = 40;
  if (proposalState.leadRating > 4.2) score += 15; // Pontos por boa reputação
  if (proposalState.leadReviews > 50) score += 10;   // Pontos por engajamento
  
  const scoreElement = document.getElementById('audit-score');
  scoreElement.innerText = score;

  // Ajustar cor do circulo de nota baseado na nota
  if (score >= 60) {
    scoreElement.style.borderColor = 'var(--accent-orange)';
    scoreElement.style.color = 'var(--accent-orange)';
    document.getElementById('audit-feedback-text').innerText = `Sua empresa tem ótimos feedbacks (${proposalState.leadRating}★), mas sua visibilidade orgânica está limitada por não ter um site.`;
  }

  // Descrição do Maps
  document.getElementById('audit-maps-rating').innerText = `Sua empresa possui avaliação média excelente de ${proposalState.leadRating} ⭐ baseada em ${proposalState.leadReviews} comentários no Google Maps.`;

  // --- MOCKUP INTERATIVO DO SITE ---
  document.getElementById('sim-nav-brand').innerText = proposalState.leadName.split(' ')[0].toUpperCase();
  document.getElementById('sim-hero-title').innerText = proposalState.leadName;
  
  const region = proposalState.leadAddress.split(',')[1] || proposalState.leadAddress.split('-')[1] || 'sua região';
  document.getElementById('sim-hero-desc').innerText = `Excelência em ${proposalState.leadCategory} na região de ${region.trim()}. Qualidade garantida com nota ${proposalState.leadRating} no Google Maps.`;
  
  document.getElementById('sim-review-score-stars').innerText = `${proposalState.leadRating} ⭐`;
  document.getElementById('sim-review-count').innerText = `baseado em ${proposalState.leadReviews} opiniões no Google Maps`;
  document.getElementById('sim-footer-address').innerText = proposalState.leadAddress;
  document.getElementById('sim-footer-phone').innerText = proposalState.leadPhone || 'Disponível no WhatsApp';

  // Gerar Serviços com base no nicho/categoria
  const categoryLower = proposalState.leadCategory.toLowerCase();
  let services = [];

  if (categoryLower.includes('dent') || categoryLower.includes('odont') || categoryLower.includes('clinic') || categoryLower.includes('saud') || categoryLower.includes('health') || categoryLower.includes('med')) {
    services = [
      { title: 'Tratamentos Clínicos', desc: 'Atendimento preventivo, limpezas e diagnóstico de ponta.', icon: 'fa-solid fa-tooth' },
      { title: 'Estética Dental', desc: 'Clareamento profissional e lentes de contato para o seu sorriso.', icon: 'fa-solid fa-wand-magic-sparkles' },
      { title: 'Urgências 24h', desc: 'Canal prioritário para atendimento em dor de dente ou acidentes.', icon: 'fa-solid fa-hand-holding-medical' }
    ];
  } else if (categoryLower.includes('mecan') || categoryLower.includes('oficin') || categoryLower.includes('auto') || categoryLower.includes('car') || categoryLower.includes('motor')) {
    services = [
      { title: 'Revisão Preventiva', desc: 'Diagnóstico computadorizado de freios, suspensão e injeção.', icon: 'fa-solid fa-screwdriver-wrench' },
      { title: 'Alinhamento e Balanceamento', desc: 'Segurança e durabilidade para os pneus do seu veículo.', icon: 'fa-solid fa-gauge-high' },
      { title: 'Reparos Mecânicos', desc: 'Troca de peças originais de motor e transmissão com garantia.', icon: 'fa-solid fa-gears' }
    ];
  } else {
    services = [
      { title: 'Atendimento Premium', desc: 'Compromisso absoluto com a sua satisfação e agilidade.', icon: 'fa-solid fa-award' },
      { title: 'Profissionais Qualificados', desc: 'Equipe certificada pronta para resolver sua necessidade.', icon: 'fa-solid fa-users' },
      { title: 'Orçamento sem Compromisso', desc: 'Preços transparentes e as melhores condições de pagamento.', icon: 'fa-solid fa-file-invoice-dollar' }
    ];
  }

  const servicesContainer = document.getElementById('sim-services-container');
  servicesContainer.innerHTML = '';
  services.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sim-service-card';
    card.innerHTML = `
      <i class="${s.icon}"></i>
      <div>
        <h4>${s.title}</h4>
        <p>${s.desc}</p>
      </div>
    `;
    servicesContainer.appendChild(card);
  });

  // Configurar botões de simulação
  const handleSimAlert = () => {
    alert(`[Simulação] Este botão abriria o WhatsApp da sua empresa (${proposalState.leadPhone || 'não cadastrado'}) com uma mensagem pronta solicitando atendimento.`);
  };
  
  document.getElementById('sim-hero-btn').addEventListener('click', handleSimAlert);
  document.getElementById('sim-whatsapp-widget-btn').addEventListener('click', handleSimAlert);
}

// Ações do Cliente (Redirecionamento para o WhatsApp do Vendedor)
function acceptProposal() {
  const text = `Olá! Recebi a proposta comercial da *${proposalState.sellerName}* e gostei muito do modelo de site personalizado para a *${proposalState.leadName}*. Gostaria de avançar com o projeto do site profissional!`;
  
  const url = `https://api.whatsapp.com/send?phone=${proposalState.sellerWhatsapp}&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function negotiateDetails() {
  const text = `Olá! Vi o diagnóstico de presença no Google da *${proposalState.leadName}* e o modelo de site interativo. Gostaria de tirar algumas dúvidas e ajustar alguns detalhes para prosseguirmos.`;
  
  const url = `https://api.whatsapp.com/send?phone=${proposalState.sellerWhatsapp}&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}
