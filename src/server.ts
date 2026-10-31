import express from "express";
import cors from "cors";
import os from "os";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import "dotenv/config";
import { prisma } from "./lib/prisma";
import { streakRoutes } from "./routes/streak.routes";
import { authRoutes } from "./routes/auth.routes";
import { classroomRoutes } from "./routes/classroom.routes";
import { questionRoutes } from "./routes/question.routes";
import { streakService } from "./services/streak.service";

const JWT_SECRET = process.env.JWT_SECRET || "enem-super-secret-jwt-key-2026";

// 1. Configuração do Servidor e CORS
const app = express();
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Log de requisições para facilitar o diagnóstico de rotas chamadas pelo frontend
app.use((req, _res, next) => {
  console.log(
    `➡️ [${new Date().toLocaleTimeString()}] [${req.method}] ${req.originalUrl} - IP: ${req.ip}`
  );
  next();
});

// ==========================================
// ROTAS DA NOSSA API
// ==========================================

// Rota de Teste
app.get("/", (req, res) => {
  res.send("API do App do ENEM rodando perfeitamente! 🚀");
});

// ==========================================
// ROTA EXPLÍCITA DE REGISTRO (POST /register)
// ==========================================
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Nome, e-mail e senha são obrigatórios." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return res
        .status(409)
        .json({ error: "Este e-mail já está cadastrado." });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const userRole: Role =
      role === "TEACHER" ? Role.TEACHER : Role.STUDENT;

    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: userRole,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        xp: true,
        currentStreak: true,
        longestStreak: true,
        iceFreezes: true,
        lastStudyDate: true,
        createdAt: true,
      },
    });

    const token = jwt.sign(
      { email: user.email, role: user.role },
      JWT_SECRET,
      { subject: user.id, expiresIn: "7d" }
    );

    return res.status(201).json({ user, token });
  } catch (error) {
    console.error("[POST /register Error]:", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao cadastrar usuário." });
  }
});

// Rotas de Autenticação (suporta /, /auth, /api e /api/auth), Salas, Questões e Ofensiva (Streak)
app.use("/", authRoutes);
app.use("/auth", authRoutes);
app.use("/api", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/classrooms", classroomRoutes);
app.use("/api/classrooms", classroomRoutes);
app.use("/questions", questionRoutes);
app.use("/api/questions", questionRoutes);
app.use("/streak", streakRoutes);
app.use("/api/streak", streakRoutes);

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
const PORT = Number(process.env.PORT) || 3333;
const HOST = "0.0.0.0";

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (
        iface.family === "IPv4" &&
        !iface.internal &&
        !iface.address.startsWith("169.254.") &&
        !iface.address.startsWith("172.")
      ) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

app.listen(PORT, HOST, () => {
  const localIp = getLocalIpAddress();
  console.log(`🚀 API rodando localmente em: http://localhost:${PORT}`);
  console.log(`📱 API na rede Wi-Fi (Expo/Celular): http://${localIp}:${PORT}`);
  console.log(
    `📚 Busque as questões em: http://${localIp}:${PORT}/api/questions`,
  );

  // Rotina diária (a cada 24h) para verificação de inatividade da ofensiva
  setInterval(() => {
    streakService.processDailyInactivityJob().catch((err) => {
      console.error("[Inactivity Job Error]:", err);
    });
  }, 1000 * 60 * 60 * 24);
});
