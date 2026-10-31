import { Router } from "express";
import { streakController } from "../controllers/streak.controller";

const streakRoutes = Router();

streakRoutes.post("/complete-lesson", (req, res) =>
  streakController.completeLesson(req, res)
);

streakRoutes.post("/verify-login", (req, res) =>
  streakController.verifyOnLogin(req, res)
);

export { streakRoutes };

