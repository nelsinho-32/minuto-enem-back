import { Router } from "express";
import { questionController } from "../controllers/question.controller";

const questionRoutes = Router();

// GET /questions
questionRoutes.get("/", (req, res) => questionController.list(req, res));

// POST /questions/answer
questionRoutes.post("/answer", (req, res) =>
  questionController.answer(req, res)
);

export { questionRoutes };

