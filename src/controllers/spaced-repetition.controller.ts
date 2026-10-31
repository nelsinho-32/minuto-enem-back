import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { spacedRepetitionService } from "../services/spaced-repetition.service";
import { AppError } from "../errors/AppError";
import { JwtPayloadData } from "../middlewares/auth.middleware";

const JWT_SECRET = process.env.JWT_SECRET || "enem-super-secret-jwt-key-2026";

export class SpacedRepetitionController {
  private resolveUserId(req: Request): string | undefined {
    if (req.user?.id) return req.user.id;
    if (req.body?.userId) return String(req.body.userId);
    if (req.query?.userId) return String(req.query.userId);
    if (req.params?.userId) return String(req.params.userId);

    if (req.headers.authorization) {
      const [, token] = req.headers.authorization.split(" ");
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as JwtPayloadData;
          return decoded.sub;
        } catch {
          return undefined;
        }
      }
    }

    return undefined;
  }

  /**
   * GET /api/spaced-repetition/due
   * Retorna os flashcards agendados para o dia de hoje (SM-2).
   */
  async getDueQueue(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);
      const limit = req.query.limit ? Number(req.query.limit) : 20;

      if (!userId) {
        return res
          .status(401)
          .json({ error: "Usuário não autenticado ou userId não fornecido." });
      }

      const result = await spacedRepetitionService.getDueFlashcards(
        userId,
        limit
      );
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * POST /api/spaced-repetition/review
   * Registra a revisão do aluno aplicando o algoritmo SM-2.
   * Body: { questionId: string, grade?: number (0..5), isCorrect?: boolean }
   */
  async submitReview(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);
      const { questionId, grade, isCorrect } = req.body;

      if (!userId) {
        return res
          .status(401)
          .json({ error: "Usuário não autenticado ou userId não fornecido." });
      }

      const result = await spacedRepetitionService.reviewCard({
        userId,
        questionId,
        grade,
        isCorrect,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * POST /api/spaced-repetition/sync
   * Sincroniza todas as tentativas erradas em flashcards para repetição espaçada.
   */
  async syncMistakes(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({ error: "Usuário não autenticado ou userId não fornecido." });
      }

      const count = await spacedRepetitionService.syncMistakesToFlashcards(
        userId
      );
      return res.status(200).json({
        syncedCount: count,
        message: `${count} novos flashcards gerados a partir dos seus erros passados.`,
      });
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * GET /api/spaced-repetition/stats
   * Métricas de retenção e contagem de cards.
   */
  async getStats(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({ error: "Usuário não autenticado ou userId não fornecido." });
      }

      const stats = await spacedRepetitionService.getStudentStats(userId);
      return res.status(200).json(stats);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  private handleError(error: unknown, res: Response): Response {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error("[SpacedRepetitionController Error]:", error);
    return res.status(500).json({
      error: "Erro interno no processamento da repetição espaçada (SM-2).",
    });
  }
}

export const spacedRepetitionController = new SpacedRepetitionController();

