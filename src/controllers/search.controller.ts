import { Request, Response } from "express";
import { searchService } from "../services/search.service";
import { AppError } from "../errors/AppError";

export class SearchController {
  /**
   * GET ou POST /api/search/questions
   * Suporta parâmetros via Query String ou Body:
   * - query / q: texto da busca semântica
   * - year / ano: filtro exato de ano (ex: 2015)
   * - subject / disciplina: filtro exato de disciplina (ex: "linguagens", "Geral", "matematica")
   * - area: filtro exato de área do conhecimento (ex: "ciencias-humanas")
   * - difficulty / dificuldade: "EASY" | "MEDIUM" | "HARD" | "FACIL" | "MEDIO" | "DIFICIL"
   * - minSimilarity: limiar mínimo de similaridade cosseno (0 a 1)
   * - limit, page: paginação
   */
  async searchQuestions(req: Request, res: Response): Promise<Response> {
    try {
      const source = { ...req.query, ...req.body };

      const query = (source.query || source.q || "") as string;
      const year =
        source.year !== undefined
          ? Number(source.year)
          : source.ano !== undefined
          ? Number(source.ano)
          : undefined;
      const subject = (source.subject || source.disciplina) as
        | string
        | undefined;
      const area = source.area as string | undefined;
      const difficulty = (source.difficulty || source.dificuldade) as
        | string
        | undefined;
      const minSimilarity =
        source.minSimilarity !== undefined
          ? Number(source.minSimilarity)
          : undefined;
      const limit =
        source.limit !== undefined ? Number(source.limit) : undefined;
      const page = source.page !== undefined ? Number(source.page) : undefined;

      const result = await searchService.searchQuestions({
        query,
        year,
        subject,
        area,
        difficulty,
        minSimilarity,
        limit,
        page,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * POST /api/search/backfill
   * Dispara a geração de embeddings via Gemini para questões antigas que estão com `embedding IS NULL`.
   */
  async backfillEmbeddings(req: Request, res: Response): Promise<Response> {
    try {
      const batchSize = req.body?.batchSize ?? req.query?.batchSize ?? 20;
      const result = await searchService.backfillQuestionEmbeddings(
        Number(batchSize)
      );

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

    console.error("[SearchController Error]:", error);
    return res.status(500).json({
      error: "Erro interno ao executar busca de questões.",
    });
  }
}

export const searchController = new SearchController();

