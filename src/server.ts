import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

// 1. Configuração do Servidor e CORS
const app = express();
app.use(cors());
app.use(express.json());

// 2. Conexão com o Banco de Dados (Mesma lógica do Seed)
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ==========================================
// ROTAS DA NOSSA API
// ==========================================

// Rota de Teste
app.get('/', (req, res) => {
  res.send('API do App do ENEM rodando perfeitamente! 🚀');
});

// Rota para buscar todas as questões (podemos filtrar por matéria depois)
app.get('/api/questions', async (req, res) => {
  try {
    const questions = await prisma.question.findMany({
      orderBy: { year: 'desc' } // Traz as mais recentes primeiro
    });
    
    return res.json(questions);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao buscar questões do banco de dados.' });
  }
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const PORT = 3333;
app.listen(PORT, () => {
  console.log(`🚀 API rodando no endereço: http://localhost:${PORT}`);
  console.log(`📚 Busque as questões em: http://localhost:${PORT}/api/questions`);
});