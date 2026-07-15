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
  deleteLead 
} from './database.js';

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Banco de Dados
initDb();

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
    const newLead = createLead(req.body);
    res.status(201).json(newLead);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar lead', details: error.message });
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

// ----------------------------------------------------
// ROTA DE BUSCA GOOGLE PLACES API / SIMULADOR
// ----------------------------------------------------
app.get('/api/search', async (req, res) => {
  const query = req.query.query || '';
  const forceSimulate = req.query.simulate === 'true';
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  console.log(`[Search] Busca solicitada: "${query}" (Simular: ${forceSimulate || !apiKey})`);

  if (!query) {
    return res.status(400).json({ error: 'Parâmetro de consulta "query" é obrigatório.' });
  }

  // Se não houver chave de API ou for solicitada simulação explícita, usa dados simulados
  if (!apiKey || forceSimulate) {
    const mockResults = generateMockPlaces(query);
    return res.json({ source: 'simulation', results: mockResults });
  }

  try {
    // Nova API do Google Places (Text Search)
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.primaryType,places.location'
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
    const places = data.places || [];

    // Mapear dados para nosso formato padrão e analisar quais não têm site
    const processedResults = places.map(place => {
      const hasWebsite = !!place.websiteUri;
      return {
        place_id: place.id,
        name: place.displayName?.text || 'Sem Nome',
        phone: place.nationalPhoneNumber || 'Sem telefone',
        address: place.formattedAddress || 'Sem endereço',
        rating: place.rating || 0,
        user_ratings_total: place.userRatingCount || 0,
        category: place.primaryType || 'Negócio Local',
        latitude: place.location?.latitude || null,
        longitude: place.location?.longitude || null,
        website: place.websiteUri || null,
        has_website: hasWebsite
      };
    });

    res.json({ source: 'google_places_api', results: processedResults });
  } catch (error) {
    console.error('[Search] Erro ao pesquisar no Google Places:', error);
    res.status(500).json({ 
      error: 'Erro ao consultar API do Google Places. Tente o modo de simulação.',
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
      has_website: hasWebsite
    };
  });
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[Server] Rodando em http://localhost:${PORT}`);
});
