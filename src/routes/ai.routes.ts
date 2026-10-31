import { Router } from "express";
import { aiController } from "../controllers/ai.controller";

const aiRoutes = Router();

// (a) Tutor Socrático com RAG (não entrega a resposta direta)
aiRoutes.post("/tutor", (req, res) => aiController.tutorQuestion(req, res));

// (b) Corretor de Redações Multimodal (5 competências do ENEM - síncrono e assíncrono via BullMQ)
aiRoutes.post("/essay", (req, res) => aiController.gradeEssay(req, res));
aiRoutes.post("/essay/async", (req, res) =>
  aiController.enqueueEssay(req, res)
);
aiRoutes.get("/essay/job/:jobId", (req, res) =>
  aiController.getEssayJob(req, res)
);

// Simulação de Nota TRI baseada em errorRate
aiRoutes.post("/tri/simulate", (req, res) =>
  aiController.simulateTri(req, res)
);

// Diagnóstico Pedagógico de Distratores
aiRoutes.post("/distractor/diagnose", (req, res) =>
  aiController.diagnoseDistractor(req, res)
);
aiRoutes.post("/distractor", (req, res) =>
  aiController.diagnoseDistractor(req, res)
);

// Gerador de Questões Inéditas baseadas em Habilidades do ENEM
aiRoutes.post("/questions/generate", (req, res) =>
  aiController.generateQuestion(req, res)
);
aiRoutes.post("/generate-question", (req, res) =>
  aiController.generateQuestion(req, res)
);

export { aiRoutes };

