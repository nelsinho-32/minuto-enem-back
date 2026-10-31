import { Request, Response } from "express";
import { authService } from "../services/auth.service";
import { AppError } from "../errors/AppError";

export class AuthController {
  /**
   * POST /api/auth/register
   */
  async register(req: Request, res: Response): Promise<Response> {
    try {
      const { name, email, password, role } = req.body;
      const result = await authService.register({ name, email, password, role });

      return res.status(201).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * POST /api/auth/login
   */
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const { email, password } = req.body;
      const result = await authService.login({ email, password });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  private handleError(error: unknown, res: Response): Response {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    console.error("[AuthController Error]:", error);
    return res.status(500).json({
      error: "Erro interno no servidor de autenticação.",
    });
  }
}

export const authController = new AuthController();

