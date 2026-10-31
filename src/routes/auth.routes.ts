import { Router } from "express";
import { authController } from "../controllers/auth.controller";

const authRoutes = Router();

// Rotas de Cadastro (suporta /register, /signup e /users)
authRoutes.post("/register", (req, res) => authController.register(req, res));
authRoutes.post("/signup", (req, res) => authController.register(req, res));
authRoutes.post("/users", (req, res) => authController.register(req, res));

// Rotas de Login (suporta /login e /sessions)
authRoutes.post("/login", (req, res) => authController.login(req, res));
authRoutes.post("/sessions", (req, res) => authController.login(req, res));

export { authRoutes };
