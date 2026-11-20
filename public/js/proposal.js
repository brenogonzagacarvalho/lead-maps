// Estado Local da Proposta
const urlParams = new URLSearchParams(window.location.search);
const apiBase = (urlParams.get('api') || window.location.origin).replace(/\/+$/, '');
const isPreviewMode = urlParams.get('preview') === '1';

let proposalState = {
  leadId: null,
  leadName: 'Sua Empresa',
  leadCategory: 'Negócio Local',
  leadPhone: '',
  leadAddress: 'Endereço Principal',
  leadRating: 0,
  leadReviews: 0,
  leadInstagram: '',
  leadFollowers: '',
  leadBio: '',
  leadServices: [],
  leadOpeningHours: '',
  leadBrandColor: '',
  leadSource: 'google_maps',
  leadReviewsSample: [],
  leadBioLink: '',
  sellerWhatsapp: '5511999999999',
  sellerName: 'Agência Web Express'
};

document.addEventListener('DOMContentLoaded', async () => {
  setGenerationDate();

  const leadId = urlParams.get('id');

  if (leadId) {
    proposalState.leadId = leadId;
    await loadProposalFromServer(leadId);
    // Sobrescreve WhatsApp/Vendedor se vier explicitamente na URL
    if (urlParams.get('sw')) proposalState.sellerWhatsapp = urlParams.get('sw').replace(/\D/g, '');
    if (urlParams.get('sn')) proposalState.sellerName = urlParams.get('sn');
  } else {
    loadProposalFromParams(urlParams);
  }

  renderProposalUI();
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function parseCompactServices(srvStr) {
  if (!srvStr || typeof srvStr !== 'string') return [];
  return srvStr
    .split(';;')
    .map(pair => {
      const [title, desc] = pair.split('|');
      return {
        title: (title || '').trim(),
        desc: (desc || '').trim()
      };
    })
    .filter(item => item.title);
}

// Configura a data do dia na proposta
function setGenerationDate() {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const today = new Date().toLocaleDateString('pt-BR', options);
  document.getElementById('proposal-date').innerText = `Gerado em ${today}`;
}

// Carregar dados de proposta do banco de dados
async function loadProposalFromServer(id) {
  try {
    const response = await fetch(`${apiBase}/api/proposal-data/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('Não foi possível obter os dados do lead');

    const data = await response.json();
    const lead = data.lead || {};

    proposalState.leadName = lead.name || 'Sua Empresa';
    proposalState.leadCategory = lead.category || 'Negócio Local';
    proposalState.leadPhone = lead.phone || '';
    proposalState.leadAddress = lead.address || 'Sua Região';
    proposalState.leadRating = Number(lead.rating) || 0;
    proposalState.leadReviews = parseInt(lead.user_ratings_total, 10) || 0;
    proposalState.leadInstagram = lead.instagram || '';
    proposalState.leadFollowers = lead.followers || '';
    proposalState.leadBio = lead.bio || '';
    proposalState.leadServices = parseJsonSafe(lead.services, []);
    proposalState.leadOpeningHours = lead.opening_hours || '';
    proposalState.leadBrandColor = lead.brand_color || '';
    proposalState.leadSource = lead.source || (lead.instagram ? 'instagram' : 'google_maps');
    proposalState.leadReviewsSample = parseJsonSafe(lead.reviews_sample, []);
    proposalState.leadBioLink = lead.bio_link || '';

    // Configurações do Vendedor
    proposalState.sellerWhatsapp = (data.whatsappContact || '5511999999999').replace(/\D/g, '');
    proposalState.sellerName = data.sellerName || 'Agência Web Express';

    // Registrar visualização apenas quando NÃO for prévia do vendedor
    if (!isPreviewMode) {
      registerViewEvent(id);
    }
  } catch (error) {
    console.error('Erro ao conectar com servidor:', error);
    loadSellerFallbackFromStorage();
  }
}

function loadSellerFallbackFromStorage() {
  try {
    const savedSettings = localStorage.getItem('maps_analyzer_settings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      if (settings.whatsapp) proposalState.sellerWhatsapp = String(settings.whatsapp).replace(/\D/g, '');
      if (settings.sellerName) proposalState.sellerName = settings.sellerName;
    }
  } catch (err) {
    console.warn('Não foi possível ler configurações locais:', err);
  }
}

// Registro silencioso de visualização pelo cliente sem apagar notas nem regredir funil
function registerViewEvent(leadId) {
  fetch(`${apiBase}/api/proposal-view/${encodeURIComponent(leadId)}`, {
    method: 'POST'
  }).catch(err => console.log('Erro ao registrar visualização:', err));
}

// Carregar diretamente da URL (Vercel estático ou preview antes de importar)
function loadProposalFromParams(params) {
  if (params.get('name')) proposalState.leadName = params.get('name');
  if (params.get('category')) proposalState.leadCategory = params.get('category');
  if (params.get('phone')) proposalState.leadPhone = params.get('phone');
  if (params.get('address')) proposalState.leadAddress = params.get('address');
  if (params.get('rating')) proposalState.leadRating = parseFloat(params.get('rating')) || 0;
  if (params.get('reviews')) proposalState.leadReviews = parseInt(params.get('reviews'), 10) || 0;
  if (params.get('ig')) proposalState.leadInstagram = params.get('ig');
  if (params.get('fol')) proposalState.leadFollowers = params.get('fol');
  if (params.get('src')) proposalState.leadSource = params.get('src');
  if (params.get('bc')) proposalState.leadBrandColor = params.get('bc');
  if (params.get('hrs')) proposalState.leadOpeningHours = params.get('hrs');
  if (params.get('bio')) proposalState.leadBio = params.get('bio');
  if (params.get('bl')) proposalState.leadBioLink = params.get('bl');
  if (params.get('srv')) proposalState.leadServices = parseCompactServices(params.get('srv'));

  if (!params.get('src') && proposalState.leadInstagram && !proposalState.leadRating) {
    proposalState.leadSource = 'instagram';
  }

  const sw = params.get('sw');
  const sn = params.get('sn');
  if (sw) proposalState.sellerWhatsapp = sw.replace(/\D/g, '');
  if (sn) proposalState.sellerName = sn;

  if (!sw || !sn) {
    loadSellerFallbackFromStorage();
  }
}

function isRestaurantNiche(textHint) {
  const lower = (textHint || '').toLowerCase();
  return /(restaur|self[\s-]?service|churrasc|pizz|hamburg|lanche|sushi|japon|acai|açaí|padar|doceria|confeit|delivery|food|gastron|culinar|culinár|caseir|espetar|nordestin|bistr|grill|frutos do mar|cafeter|cantina|\bbar\b)/.test(
    lower
  );
}

function getDefaultServicesByNiche(textHint) {
  const lower = (textHint || '').toLowerCase();

  if (/(dent|odont|clinic|clínic|saud|saúd|health|medic|médic|fisioter|psicol|nutri)/.test(lower)) {
    return [
      { title: 'Atendimento Especializado', desc: 'Avaliação completa e planos personalizados com foco no seu bem-estar.', icon: 'fa-solid fa-heart-pulse' },
      { title: 'Agendamento Facilitado', desc: 'Confirme horários e tire dúvidas diretamente pelo WhatsApp.', icon: 'fa-solid fa-calendar-check' },
      { title: 'Estrutura Moderna', desc: 'Ambiente acolhedor com profissionais qualificados e tecnologia atual.', icon: 'fa-solid fa-user-doctor' }
    ];
  }

  if (/(mecan|mecân|oficin|auto|car|motor|funilar|pneu|repar)/.test(lower)) {
    return [
      { title: 'Revisão Preventiva', desc: 'Diagnóstico completo de freios, suspensão, óleo e injeção eletrônica.', icon: 'fa-solid fa-screwdriver-wrench' },
      { title: 'Alinhamento e Manutenção', desc: 'Mais segurança, economia e durabilidade para o seu veículo.', icon: 'fa-solid fa-gauge-high' },
      { title: 'Orçamento Transparente', desc: 'Peças de procedência com garantia e aprovação rápida no WhatsApp.', icon: 'fa-solid fa-gears' }
    ];
  }

  if (/(estetic|estétic|salao|salão|sobrancelh|cilios|cílios|unha|nail|lash|manicure|beleza|cabelo|harmoniz|spa)/.test(lower)) {
    return [
      { title: 'Procedimentos Exclusivos', desc: 'Protocolos modernos para realçar sua beleza natural com segurança.', icon: 'fa-solid fa-wand-magic-sparkles' },
      { title: 'Atendimento Personalizado', desc: 'Avaliação individual para indicar o tratamento ideal para você.', icon: 'fa-solid fa-spa' },
      { title: 'Horário Agendado', desc: 'Reserve seu horário com praticidade direto pelo WhatsApp.', icon: 'fa-regular fa-clock' }
    ];
  }

  if (/(barbear|barber)/.test(lower)) {
    return [
      { title: 'Corte & Visagismo', desc: 'Cortes modernos e clássicos alinhados ao seu estilo.', icon: 'fa-solid fa-scissors' },
      { title: 'Barba & Navalha', desc: 'Acabamento preciso com toalha quente e produtos premium.', icon: 'fa-solid fa-spray-can-sparkles' },
      { title: 'Reserva sem Fila', desc: 'Agende seu horário em segundos pelo WhatsApp.', icon: 'fa-solid fa-calendar-day' }
    ];
  }

  if (isRestaurantNiche(lower)) {
    return [
      {
        title: 'Cardápio Digital Organizado',
        desc: 'Pratos do dia, combos e especialidades fáceis de ler no celular, sem fotos antigas ou confusas.',
        icon: 'fa-solid fa-utensils'
      },
      {
        title: 'Pedido no WhatsApp (Sem Taxa)',
        desc: 'Delivery, marmitas e retirada no balcão direto com vocês, sem comissão de aplicativo.',
        icon: 'fa-solid fa-motorcycle'
      },
      {
        title: 'Reservas, Grupos & Eventos',
        desc: 'Praticidade para famílias, turistas e empresas reservarem mesa ou fazerem encomendas.',
        icon: 'fa-solid fa-champagne-glasses'
      }
    ];
  }

  if (/(pet|veterin|banho|tosa|cao|cão|animal)/.test(lower)) {
    return [
      { title: 'Banho & Tosa', desc: 'Cuidado carinhoso e produtos adequados para o bem-estar do seu pet.', icon: 'fa-solid fa-paw' },
      { title: 'Saúde Veterinária', desc: 'Consultas, vacinas e acompanhamento preventivo completo.', icon: 'fa-solid fa-stethoscope' },
      { title: 'Rações & Acessórios', desc: 'As melhores marcas com entrega rápida na sua região.', icon: 'fa-solid fa-bag-shopping' }
    ];
  }

  if (/(moda|roupa|boutique|calcad|calçad|loja|acessor|joia|otica|ótica|present)/.test(lower)) {
    return [
      { title: 'Catálogo de Novidades', desc: 'Coleções selecionadas com fotos, tamanhos e atendimento consultivo.', icon: 'fa-solid fa-shirt' },
      { title: 'Compra Facilitada', desc: 'Tire dúvidas de modelos e feche seu pedido direto no WhatsApp.', icon: 'fa-solid fa-bag-shopping' },
      { title: 'Envio & Retirada', desc: 'Entrega ágil na cidade ou retirada rápida na loja física.', icon: 'fa-solid fa-truck-fast' }
    ];
  }

  if (/(marcen|construt|arquit|engenh|eletric|hidraul|reforma|movel|móvel|planejad)/.test(lower)) {
    return [
      { title: 'Projetos Sob Medida', desc: 'Execução cuidadosa com acabamento de alto padrão e prazo definido.', icon: 'fa-solid fa-ruler-combined' },
      { title: 'Visita Técnica', desc: 'Avaliação no local para orçamento detalhado sem surpresas.', icon: 'fa-solid fa-helmet-safety' },
      { title: 'Garantia & Pós-Obra', desc: 'Equipe experiente e suporte completo do início à entrega.', icon: 'fa-solid fa-shield-halved' }
    ];
  }

  return [
    { title: 'Atendimento Premium', desc: 'Compromisso absoluto com a sua satisfação e agilidade no retorno.', icon: 'fa-solid fa-award' },
    { title: 'Equipe Especializada', desc: 'Profissionais experientes prontos para indicar a melhor solução.', icon: 'fa-solid fa-users' },
    { title: 'Orçamento no WhatsApp', desc: 'Atendimento direto, transparente e sem burocracia.', icon: 'fa-solid fa-file-invoice-dollar' }
  ];
}

function formatBrandTitle(name) {
  const words = (name || 'Empresa').trim().split(/\s+/).filter(Boolean);
  const short = words.slice(0, 2).join(' ');
  return short.slice(0, 18).toUpperCase();
}

function renderMockupReviewsSection(isInstagram) {
  const container = document.getElementById('sim-reviews-container');
  const reviewsSample = Array.isArray(proposalState.leadReviewsSample) ? proposalState.leadReviewsSample : [];

  if (reviewsSample.length > 0) {
    const cardsHtml = reviewsSample
      .map(rev => {
        const stars = '⭐'.repeat(Math.min(5, Math.max(1, parseInt(rev.rating, 10) || 5)));
        const initial = escapeHtml((rev.author || 'C').charAt(0).toUpperCase());
        return `
          <div class="sim-review-card">
            <div class="sim-reviewer-info">
              <div class="sim-reviewer-avatar">${initial}</div>
              <div>
                <div class="sim-reviewer-name">${escapeHtml(rev.author || 'Cliente Local')}</div>
                <div class="sim-reviewer-stars">${stars}</div>
              </div>
            </div>
            <p class="sim-reviewer-text">"${escapeHtml(rev.text)}"</p>
          </div>
        `;
      })
      .join('');

    container.innerHTML = `
      <h3 class="sim-section-title">Avaliações dos Clientes</h3>
      ${proposalState.leadRating > 0 ? `
        <div class="sim-review-summary">
          <div class="sim-review-score">${proposalState.leadRating} ⭐</div>
          <div style="font-size: 0.65rem; color: var(--text-dimmed);">baseado em ${proposalState.leadReviews} opiniões no Google Maps</div>
        </div>
      ` : ''}
      ${cardsHtml}
    `;
    return;
  }

  if (proposalState.leadRating > 0 && !isInstagram) {
    container.innerHTML = `
      <h3 class="sim-section-title">Reputação Local</h3>
      <div class="sim-review-summary">
        <div class="sim-review-score">${proposalState.leadRating} ⭐</div>
        <div style="font-size: 0.65rem; color: var(--text-dimmed);">baseado em ${proposalState.leadReviews} opiniões no Google Maps</div>
      </div>
      <div class="sim-review-card">
        <div class="sim-reviewer-info">
          <div class="sim-reviewer-avatar"><i class="fa-solid fa-shield-check"></i></div>
          <div>
            <div class="sim-reviewer-name">Perfil Verificado na Região</div>
            <div class="sim-reviewer-stars">Atendimento de Confiança</div>
          </div>
        </div>
        <p class="sim-reviewer-text">Site integrado diretamente ao Google Maps e ao seu WhatsApp oficial para converter buscas locais em clientes.</p>
      </div>
    `;
    return;
  }

  // Origem Instagram ou sem nota no Maps — sem avaliações falsas!
  container.innerHTML = `
    <h3 class="sim-section-title">Diferenciais &amp; Presença</h3>
    ${proposalState.leadInstagram ? `
      <div class="sim-review-card">
        <div class="sim-reviewer-info">
          <div class="sim-reviewer-avatar"><i class="fa-brands fa-instagram"></i></div>
          <div>
            <div class="sim-reviewer-name">${escapeHtml(proposalState.leadInstagram)}</div>
            <div class="sim-reviewer-stars">${escapeHtml(proposalState.leadFollowers || 'Comunidade Ativa no Instagram')}</div>
          </div>
        </div>
        <p class="sim-reviewer-text">Agora seus seguidores e novos clientes do Google encontram todos os serviços e orçamento em um só lugar.</p>
      </div>
    ` : ''}
    <div class="sim-review-card">
      <div class="sim-reviewer-info">
        <div class="sim-reviewer-avatar"><i class="fa-brands fa-whatsapp"></i></div>
        <div>
          <div class="sim-reviewer-name">Orçamento em 1 Clique</div>
          <div class="sim-reviewer-stars">Atendimento Rápido</div>
        </div>
      </div>
      <p class="sim-reviewer-text">Botão direto no WhatsApp com mensagem pronta para fechar mais vendas pelo celular.</p>
    </div>
  `;
}

function renderWhyWebsiteSection(isRestaurant) {
  const titleEl = document.getElementById('proposal-why-title');
  const subtitleEl = document.getElementById('proposal-why-subtitle');
  const gridEl = document.getElementById('proposal-why-grid');
  if (!gridEl) return;

  if (titleEl) {
    titleEl.innerText = isRestaurant
      ? 'Por que ter uma página própria se o restaurante já está no Google Maps?'
      : 'Por que ter um site próprio se você já está no Google Maps?';
  }
  if (subtitleEl) {
    subtitleEl.innerText = isRestaurant
      ? 'O Maps atrai quem procura onde comer; a página própria transforma essa busca em pedidos e reservas sem taxa de aplicativo.'
      : 'O Google Maps não é substituído — o site trabalha junto com ele para transformar visitas em clientes diretos.';
  }

  const cards = isRestaurant
    ? [
        {
          icon: 'fa-solid fa-map-location-dot',
          title: 'O Maps traz a visita — o site fecha o pedido',
          desc: 'No Google Maps seus concorrentes aparecem logo abaixo do seu perfil. No seu site, o cliente vê só a sua marca, seus pratos e o botão de pedir ou reservar.'
        },
        {
          icon: 'fa-solid fa-percent',
          title: 'Mais margem sem taxa de 12% a 27%',
          desc: 'Direcione delivery, marmitas e encomendas para o seu WhatsApp próprio. Recuperar poucos pedidos por mês fora de aplicativos já paga o investimento.'
        },
        {
          icon: 'fa-solid fa-bolt',
          title: 'Menos travamento no horário de pico',
          desc: 'Cardápio atualizado, horários, endereço e botão de reserva no celular 24h — ideal para clientes do bairro, grupos e turistas.'
        }
      ]
    : [
        {
          icon: 'fa-solid fa-map-location-dot',
          title: 'O Maps traz a visita — o site fecha o cliente',
          desc: 'No Google Maps seus concorrentes aparecem na mesma tela. No seu site, o cliente foca 100% no seu trabalho e chama no WhatsApp em 1 clique.'
        },
        {
          icon: 'fa-solid fa-magnifying-glass-chart',
          title: 'Mais autoridade e buscas no Google',
          desc: 'Empresas com página própria passam mais confiança antes do contato e fortalecem o ranqueamento local no Google e no próprio Maps.'
        },
        {
          icon: 'fa-solid fa-shield-halved',
          title: 'Canal 100% seu, funcionando 24h',
          desc: 'Redes sociais podem cair e o perfil do Maps é limitado. Seu site organiza serviços, provas reais e capta orçamentos mesmo fora do horário comercial.'
        }
      ];

  gridEl.innerHTML = cards
    .map(
      card => `
        <div class="proposal-why-card">
          <div class="proposal-why-icon"><i class="${escapeHtml(card.icon)}"></i></div>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.desc)}</p>
        </div>
      `
    )
    .join('');
}

// Renderizar elementos na página
function renderProposalUI() {
  if (isPreviewMode) {
    document.getElementById('seller-preview-bar').style.display = 'flex';
  }

  const mockupEl = document.getElementById('device-mockup-capture');
  if (proposalState.leadBrandColor && /^#[0-9a-fA-F]{6}$/.test(proposalState.leadBrandColor)) {
    mockupEl.style.setProperty('--sim-brand', proposalState.leadBrandColor);
  }

  const isInstagram =
    proposalState.leadSource === 'instagram' ||
    (Boolean(proposalState.leadInstagram) && (!proposalState.leadRating || proposalState.leadRating === 0));
  const nicheHint = `${proposalState.leadCategory} ${proposalState.leadName} ${proposalState.leadBio}`;
  const isRestaurant = isRestaurantNiche(nicheHint);

  // Atualizar Textos Principais
  document.getElementById('proposal-heading').innerText = `Análise Comercial: ${proposalState.leadName}`;
  if (isRestaurant) {
    document.getElementById('proposal-subheading').innerText = isInstagram
      ? `Preparamos um diagnóstico digital e uma página exclusiva de cardápio e pedidos para transformar seguidores da ${proposalState.leadName} em clientes no WhatsApp, sem taxa de aplicativo.`
      : `O Google Maps já traz clientes até a ${proposalState.leadName} — veja como transformar essas visitas em pedidos no WhatsApp e reservas diretas, sem pagar comissão de aplicativos.`;
  } else {
    document.getElementById('proposal-subheading').innerText = isInstagram
      ? `Preparamos um diagnóstico digital e um conceito exclusivo de site para transformar seguidores da ${proposalState.leadName} em clientes todos os dias.`
      : `Preparamos um diagnóstico de presença no Google Maps e um conceito de site exclusivo para a ${proposalState.leadName}.`;
  }

  // Pontuação e Diagnóstico
  let score = isInstagram ? 45 : 40;
  if (isInstagram) {
    if (proposalState.leadFollowers || proposalState.leadBio) score += 10;
  } else {
    if (proposalState.leadRating >= 4.2) score += 15;
    if (proposalState.leadReviews > 50) score += 10;
  }

  const scoreElement = document.getElementById('audit-score');
  scoreElement.innerText = score;
  if (score >= 55) {
    scoreElement.style.borderColor = 'var(--accent-orange)';
    scoreElement.style.color = 'var(--accent-orange)';
  }

  if (isInstagram) {
    const handleLabel = proposalState.leadInstagram || 'Instagram Ativo';
    document.getElementById('audit-item-1-title').innerText = `Presença Ativa no Instagram (${handleLabel})`;
    document.getElementById('audit-item-1-desc').innerText = proposalState.leadFollowers
      ? `${proposalState.leadFollowers} — seu público já acompanha a loja por lá, mas depende apenas da rede social.`
      : 'Seu público já acompanha a empresa no Instagram, mas ainda falta um endereço próprio fora das redes sociais.';

    document.getElementById('audit-item-2-title').innerText = isRestaurant
      ? 'Sem Página Própria de Cardápio & Pedidos na Bio'
      : 'Sem Site Próprio na Bio';
    document.getElementById('audit-item-2-desc').innerText = proposalState.leadBioLink
      ? 'Hoje o link da bio direciona para um agregador/WhatsApp genérico, sem apresentar seus diferenciais e autoridade antes do contato.'
      : 'Quem encontra seu perfil ou pesquisa no Google não encontra um site oficial para conhecer sua oferta e fechar pedido.';

    document.getElementById('audit-feedback-text').innerText = isRestaurant
      ? 'Sua marca já gera atenção no Instagram, mas sem uma página própria de cardápio você perde pedidos diretos e buscas do Google.'
      : 'Sua marca já gera atenção no Instagram, mas sem um site próprio você perde buscas do Google e deixa dinheiro na mesa.';
  } else {
    document.getElementById('audit-item-1-title').innerText = 'Empresa Listada no Google Maps';
    if (proposalState.leadRating > 0) {
      document.getElementById('audit-item-1-desc').innerText =
        `Sua empresa possui avaliação média de ${proposalState.leadRating} ⭐ baseada em ${proposalState.leadReviews} comentários no Google Maps.`;
      document.getElementById('audit-feedback-text').innerText = isRestaurant
        ? `Vocês já têm ótimas avaliações (${proposalState.leadRating}★), mas quem acha o perfil no Maps não encontra um site/cardápio para pedir ou reservar direto.`
        : `Sua empresa tem ótimos feedbacks (${proposalState.leadRating}★), mas sem um site cadastrado parte das visitas do Maps acaba indo para concorrentes.`;
    } else {
      document.getElementById('audit-item-1-desc').innerText =
        'Sua empresa já aparece nas buscas locais do Google Maps para clientes da região.';
      document.getElementById('audit-feedback-text').innerText =
        'Sua empresa já está visível no Google, mas sem um site cadastrado concorrentes acabam ficando com a maioria dos cliques.';
    }

    if (isRestaurant) {
      document.getElementById('audit-item-2-title').innerText = 'Botão "Site / Cardápio" Sem Página Própria';
      document.getElementById('audit-item-2-desc').innerText =
        'Quem encontra vocês no Maps não vê os pratos organizados nem consegue pedir ou reservar em 1 clique — e o próprio Maps mostra concorrentes logo abaixo.';
    } else {
      document.getElementById('audit-item-2-title').innerText = 'Sem Site Próprio para Converter quem Vem do Maps';
      document.getElementById('audit-item-2-desc').innerText =
        'O Maps ajuda a localizar vocês, mas sem um site cadastrado o cliente não vê seus serviços em detalhes e o próprio Maps exibe concorrentes logo abaixo.';
    }
  }

  if (isRestaurant) {
    document.getElementById('audit-item-3-title').innerText = 'Margem Pressionada por Aplicativos (12% a 27%)';
    document.getElementById('audit-item-3-desc').innerText =
      'Sem canal próprio conectado ao Maps e Instagram, pedidos de delivery e marmitas acabam indo para aplicativos com comissão por venda.';
    document.getElementById('audit-item-4-title').innerText = 'Perguntas Repetitivas no Horário de Pico';
    document.getElementById('audit-item-4-desc').innerText =
      'Clientes chamam só para pedir cardápio, preço ou horário. Uma página rápida no celular responde tudo e já envia o pedido pronto no WhatsApp.';
  } else {
    document.getElementById('audit-item-3-title').innerText = 'Buscas Locais Indo para Concorrentes com Site';
    document.getElementById('audit-item-3-desc').innerText =
      'Vincular um site com seus serviços e bairro fortalece o perfil no Maps e faz você aparecer também nas buscas normais do Google.';
    document.getElementById('audit-item-4-title').innerText = 'Falta de Canal Próprio 24h para Orçamentos';
    document.getElementById('audit-item-4-desc').innerText =
      'Fora do horário comercial ou no horário de pico, uma página própria apresenta seus diferenciais e leva o cliente pronto para o WhatsApp.';
  }

  // --- MOCKUP INTERATIVO DO SITE ---
  document.getElementById('sim-nav-brand').innerText = formatBrandTitle(proposalState.leadName);
  document.getElementById('sim-hero-title').innerText = proposalState.leadName;
  document.getElementById('sim-services-title').innerText = isRestaurant
    ? 'Destaques do Cardápio & Pedidos'
    : 'Serviços & Especialidades';
  document.getElementById('sim-hero-btn').innerHTML = isRestaurant
    ? '<i class="fa-brands fa-whatsapp"></i> Ver Cardápio &amp; Pedir'
    : '<i class="fa-brands fa-whatsapp"></i> Falar no WhatsApp';

  const igPill = document.getElementById('sim-ig-pill');
  if (proposalState.leadInstagram) {
    igPill.style.display = 'inline-flex';
    igPill.querySelector('span').innerText = proposalState.leadInstagram;
  } else {
    igPill.style.display = 'none';
  }

  const regionPart = proposalState.leadAddress.split(',')[1] || proposalState.leadAddress.split('-')[1] || '';
  const cleanRegion = regionPart.trim() || proposalState.leadAddress || 'sua região';

  if (proposalState.leadBio && proposalState.leadBio.trim()) {
    const cleanBio = proposalState.leadBio.trim().replace(/\s+/g, ' ').slice(0, 170);
    document.getElementById('sim-hero-desc').innerText = cleanBio;
  } else if (isRestaurant) {
    document.getElementById('sim-hero-desc').innerText =
      proposalState.leadRating > 0
        ? `Gastronomia de referência em ${cleanRegion} (nota ${proposalState.leadRating}★ no Maps). Cardápio atualizado e pedido ou reserva direto no WhatsApp.`
        : `Sabores selecionados em ${cleanRegion}. Confira o cardápio do dia e peça ou reserve sua mesa direto no WhatsApp.`;
  } else if (proposalState.leadRating > 0) {
    document.getElementById('sim-hero-desc').innerText =
      `Excelência em ${proposalState.leadCategory} na região de ${cleanRegion}. Qualidade reconhecida com nota ${proposalState.leadRating} no Google Maps.`;
  } else {
    document.getElementById('sim-hero-desc').innerText =
      `Referência em ${proposalState.leadCategory} em ${cleanRegion}. Atendimento ágil e orçamento direto pelo WhatsApp.`;
  }

  document.getElementById('sim-footer-address').innerText = proposalState.leadAddress || 'Atendimento local e online';
  document.getElementById('sim-footer-phone').innerText = proposalState.leadPhone || 'Disponível no WhatsApp';
  document.getElementById('sim-hours').innerText = proposalState.leadOpeningHours || 'Segunda a Sábado: 08:00 às 18:00';

  // Gerar Serviços (prioridade para serviços extraídos do print pela IA)
  const fallbackServices = getDefaultServicesByNiche(nicheHint);
  const extractedServices = Array.isArray(proposalState.leadServices) && proposalState.leadServices.length > 0
    ? proposalState.leadServices.map((item, idx) => ({
        title: item.title || `Serviço ${idx + 1}`,
        desc: item.desc || 'Atendimento especializado com qualidade e garantia.',
        icon: fallbackServices[idx % fallbackServices.length]?.icon || 'fa-solid fa-check-double'
      }))
    : fallbackServices;

  const servicesContainer = document.getElementById('sim-services-container');
  servicesContainer.innerHTML = '';
  extractedServices.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sim-service-card';
    card.innerHTML = `
      <i class="${escapeHtml(s.icon)}"></i>
      <div>
        <h4>${escapeHtml(s.title)}</h4>
        <p>${escapeHtml(s.desc)}</p>
      </div>
    `;
    servicesContainer.appendChild(card);
  });

  // Renderizar seção de Avaliações / Diferenciais e Bloco "Por que ter um site além do Maps"
  renderMockupReviewsSection(isInstagram);
  renderWhyWebsiteSection(isRestaurant);

  // Adaptar CTA final por nicho
  const ctaDesc = document.getElementById('proposal-cta-desc');
  const ctaAcceptBtn = document.getElementById('cta-accept-btn');
  if (isRestaurant) {
    if (ctaDesc) {
      ctaDesc.innerText =
        'Conectamos esta página direto no botão "Site" do seu Google Maps e na bio do Instagram em até 7 dias — com domínio próprio, cardápio organizado e pedidos/reservas no WhatsApp sem taxa de aplicativo.';
    }
    if (ctaAcceptBtn) {
      ctaAcceptBtn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Quero Minha Página de Cardápio &amp; Pedidos!';
    }
  } else {
    if (ctaDesc) {
      ctaDesc.innerText =
        'Conectamos este site ao seu Google Maps e Instagram com domínio próprio (ex: www.suaempresa.com.br) em menos de 7 dias para transformar buscas locais em clientes.';
    }
    if (ctaAcceptBtn) {
      ctaAcceptBtn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Quero Garantir Meu Site Profissional!';
    }
  }

  // Configurar botões simulados dentro do celular
  const handleSimAlert = () => {
    const actionLabel = isRestaurant ? 'pedido ou reserva' : 'orçamento';
    alert(
      `[Simulação] Este botão abriria o WhatsApp da ${proposalState.leadName} (${proposalState.leadPhone || 'número da loja'}) com uma mensagem pronta de ${actionLabel}.`
    );
  };

  document.getElementById('sim-hero-btn').onclick = handleSimAlert;
  document.getElementById('sim-whatsapp-widget-btn').onclick = handleSimAlert;
}

// Ações do Cliente (Redirecionamento para o WhatsApp do Vendedor)
function acceptProposal(selectedPlan = '') {
  const planNote = selectedPlan ? ` Tenho interesse no *${selectedPlan}*.` : '';
  const text = `Olá! Recebi a proposta comercial da *${proposalState.sellerName}* e gostei muito do modelo de página/site personalizado para a *${proposalState.leadName}*.${planNote} Gostaria de avançar com o projeto!`;

  const url = `https://api.whatsapp.com/send?phone=${proposalState.sellerWhatsapp}&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function negotiateDetails() {
  const text = `Olá! Vi o diagnóstico de presença online da *${proposalState.leadName}* e o modelo de página interativa. Gostaria de tirar algumas dúvidas e ajustar alguns detalhes para prosseguirmos.`;

  const url = `https://api.whatsapp.com/send?phone=${proposalState.sellerWhatsapp}&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// Ferramentas do Vendedor (Preview Bar)
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);

  const cdns = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
  ];

  return new Promise((resolve, reject) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= cdns.length) {
        reject(new Error('Não foi possível carregar a biblioteca de captura de imagem.'));
        return;
      }
      const script = document.createElement('script');
      script.src = cdns[idx++];
      script.onload = () => {
        if (window.html2canvas) resolve(window.html2canvas);
        else tryNext();
      };
      script.onerror = tryNext;
      document.head.appendChild(script);
    };
    tryNext();
  });
}

async function downloadMockupImage() {
  const btn = document.getElementById('download-mockup-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando PNG...';

  try {
    const html2canvas = await loadHtml2Canvas();
    const target = document.getElementById('device-mockup-capture');
    const canvas = await html2canvas(target, {
      backgroundColor: '#090d16',
      scale: 2,
      useCORS: true,
      logging: false
    });

    const slug = (proposalState.leadName || 'empresa')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'empresa';

    const link = document.createElement('a');
    link.download = `mockup-${slug}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Erro ao gerar imagem do mockup:', err);
    alert('Não foi possível gerar o PNG automaticamente. Verifique sua conexão ou tire um print da tela.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function copyClientProposalLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete('preview');
  const clientUrl = url.toString();

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(clientUrl);
    } else {
      const temp = document.createElement('textarea');
      temp.value = clientUrl;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    alert('Link do cliente copiado para a área de transferência!');
  } catch {
    prompt('Copie o link da proposta para enviar ao cliente:', clientUrl);
  }
}
