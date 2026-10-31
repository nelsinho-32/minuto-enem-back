import { Router } from "express";
import { trailController } from "../controllers/trail.controller";

const trailRoutes = Router();

trailRoutes.get("/", (req, res) => trailController.list(req, res));
trailRoutes.get("/progress/:userId", (req, res) =>
  trailController.listUserProgress(req, res)
);
trailRoutes.get("/:id", (req, res) => trailController.getById(req, res));
trailRoutes.post("/", (req, res) => trailController.create(req, res));
trailRoutes.put("/:id", (req, res) => trailController.update(req, res));
trailRoutes.patch("/:id", (req, res) => trailController.update(req, res));
trailRoutes.delete("/:id", (req, res) => trailController.delete(req, res));

// Endpoints para atualizar/registrar avanço do aluno na trilha (TrailProgress)
trailRoutes.post("/:id/progress", (req, res) =>
  trailController.updateProgress(req, res)
);
trailRoutes.put("/:id/progress", (req, res) =>
  trailController.updateProgress(req, res)
);

export { trailRoutes };

