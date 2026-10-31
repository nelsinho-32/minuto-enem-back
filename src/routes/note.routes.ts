import { Router } from "express";
import { noteController } from "../controllers/note.controller";

const noteRoutes = Router();

noteRoutes.get("/", (req, res) => noteController.list(req, res));
noteRoutes.get("/user/:userId", (req, res) => noteController.list(req, res));
noteRoutes.get("/:id", (req, res) => noteController.getById(req, res));
noteRoutes.post("/", (req, res) => noteController.create(req, res));
noteRoutes.put("/:id", (req, res) => noteController.update(req, res));
noteRoutes.patch("/:id", (req, res) => noteController.update(req, res));
noteRoutes.delete("/:id", (req, res) => noteController.delete(req, res));

export { noteRoutes };

