import { Request, Response } from "express";
import { streakService } from "../services/streak.service";
import { AppError } from "../errors/AppError";

export class StreakController {
  /**
   * POST /api/streak/complete-lesson
   * Body ou Params: { userId: string }
   */
  async completeLesson(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req.body?.userId || req.params?.userId) as string;

      const result = await streakService.completeLesson(userId);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * POST /api/streak/verify-login
   * Body ou Params: { userId: string }
   */
  async verifyOnLogin(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req.body?.userId || req.params?.userId) as string;

      const result = await streakService.verifyStreakOnLogin(userId);
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

    console.error("[StreakController Error]:", error);
    return res.status(500).json({
      error: "Erro interno ao processar a ofensiva do usuário.",
    });
  }
}

export const streakController = new StreakController();

