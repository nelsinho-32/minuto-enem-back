import { Router } from "express";
import { spacedRepetitionController } from "../controllers/spaced-repetition.controller";

const spacedRepetitionRoutes = Router();

// Fila de flashcards devidos hoje para o aluno
spacedRepetitionRoutes.get("/due", (req, res) =>
  spacedRepetitionController.getDueQueue(req, res)
);
spacedRepetitionRoutes.get("/queue/:userId", (req, res) =>
  spacedRepetitionController.getDueQueue(req, res)
);

// Registrar a revisão de um flashcard (algoritmo SM-2)
spacedRepetitionRoutes.post("/review", (req, res) =>
  spacedRepetitionController.submitReview(req, res)
);

// Sincronizar erros passados do aluno em flashcards
spacedRepetitionRoutes.post("/sync", (req, res) =>
  spacedRepetitionController.syncMistakes(req, res)
);

// Métricas de retenção e estatísticas
spacedRepetitionRoutes.get("/stats", (req, res) =>
  spacedRepetitionController.getStats(req, res)
);
spacedRepetitionRoutes.get("/stats/:userId", (req, res) =>
  spacedRepetitionController.getStats(req, res)
);

export { spacedRepetitionRoutes };

