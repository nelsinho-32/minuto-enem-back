import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { questionService } from "../services/question.service";
import { AppError } from "../errors/AppError";
import { JwtPayloadData } from "../middlewares/auth.middleware";

const JWT_SECRET = process.env.JWT_SECRET || "enem-super-secret-jwt-key-2026";

export class QuestionController {
  /**
   * GET /questions ou GET /api/questions
   */
  async list(req: Request, res: Response): Promise<Response> {
    try {
      const { subject, area } = req.query;
      const questions = await questionService.listQuestions(
        subject as string | undefined,
        area as string | undefined
      );

      return res.status(200).json(questions);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * POST /questions/answer
   * Processa a resposta do aluno, incrementa currentStreak e reseta iceFreezes para 0.
   */
  async answer(req: Request, res: Response): Promise<Response> {
    try {
      // Permite identificar o usuário pelo body (userId) ou pelo token Bearer se enviado
      let userId: string | undefined = req.user?.id || req.body?.userId;

      if (!userId && req.headers.authorization) {
        const [, token] = req.headers.authorization.split(" ");
        if (token) {
          try {
            const decoded = jwt.verify(token, JWT_SECRET) as JwtPayloadData;
            userId = decoded.sub;
          } catch {
            // Se o token for inválido e não houver userId no body, cairá na validação abaixo
          }
        }
      }

      const questionId = req.body?.questionId || req.body?.id;
      const selectedAnswer =
        req.body?.selectedAnswer ??
        req.body?.answer ??
        req.body?.selectedOption ??
        req.body?.optionIndex;

      const result = await questionService.answerQuestion({
        userId: userId as string,
        questionId,
        selectedAnswer,
      });

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

    console.error("[QuestionController Error]:", error);
    return res.status(500).json({
      error: "Erro interno ao processar a resolução da questão.",
    });
  }
}

export const questionController = new QuestionController();

