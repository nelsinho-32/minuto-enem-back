import { Router } from "express";
import { taskController } from "../controllers/task.controller";

const taskRoutes = Router();

taskRoutes.get("/", (req, res) => taskController.list(req, res));
taskRoutes.get("/classroom/:classId", (req, res) =>
  taskController.list(req, res)
);
taskRoutes.get("/:id", (req, res) => taskController.getById(req, res));
taskRoutes.post("/", (req, res) => taskController.create(req, res));
taskRoutes.put("/:id", (req, res) => taskController.update(req, res));
taskRoutes.patch("/:id", (req, res) => taskController.update(req, res));
taskRoutes.delete("/:id", (req, res) => taskController.delete(req, res));

export { taskRoutes };

