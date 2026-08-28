import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

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
app.get("/", (req, res) => {
  res.send("API do App do ENEM rodando perfeitamente! 🚀");
});

// Rota para buscar todas as questões (podemos filtrar por matéria depois)
app.get("/api/questions", async (req, res) => {
  try {
    const questions = await prisma.question.findMany({
      orderBy: { year: "desc" }, // Traz as mais recentes primeiro
    });

    return res.json(questions);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "Erro ao buscar questões do banco de dados." });
  }
});

// ==========================================
// ROTAS DE MATÉRIAS E AULAS
// ==========================================

// 1. Retorna todas as matérias e os títulos das aulas (para montar o menu)
app.get("/api/subjects", async (req, res) => {
  try {
    const subjects = await prisma.subject.findMany({
      include: {
        lessons: {
          select: { id: true, title: true }, // Ocultamos o 'content' aqui para a API ficar super rápida
        },
      },
    });
    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar matérias" });
  }
});

// 2. Retorna o conteúdo completo de uma aula específica (para a tela de leitura)
app.get("/api/lessons/:id", async (req, res) => {
  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: req.params.id },
      include: { subject: true },
    });

    if (!lesson) return res.status(404).json({ error: "Aula não encontrada" });

    res.json(lesson);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar aula" });
  }
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const PORT = 3333;
app.listen(PORT, () => {
  console.log(`🚀 API rodando no endereço: http://localhost:${PORT}`);
  console.log(
    `📚 Busque as questões em: http://localhost:${PORT}/api/questions`,
  );
});
