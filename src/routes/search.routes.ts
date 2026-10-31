import { Router } from "express";
import { searchController } from "../controllers/search.controller";

const searchRoutes = Router();

// Busca semântica + filtros exatos (aceita GET com query params ou POST com JSON body)
searchRoutes.get("/", (req, res) =>
  searchController.searchQuestions(req, res)
);
searchRoutes.post("/", (req, res) =>
  searchController.searchQuestions(req, res)
);
searchRoutes.get("/questions", (req, res) =>
  searchController.searchQuestions(req, res)
);
searchRoutes.post("/questions", (req, res) =>
  searchController.searchQuestions(req, res)
);

// Endpoint utilitário para indexar embeddings das questões já existentes no banco
searchRoutes.post("/backfill", (req, res) =>
  searchController.backfillEmbeddings(req, res)
);

export { searchRoutes };

