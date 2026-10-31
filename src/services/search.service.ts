import { Prisma } from "@prisma/client";
import { basePrisma } from "../lib/prisma";
import { embeddingService } from "./embedding.service";
import { AppError } from "../errors/AppError";

export type DifficultyLevel =
  | "EASY"
  | "MEDIUM"
  | "HARD"
  | "FACIL"
  | "MEDIO"
  | "DIFICIL";

export interface QuestionSearchParams {
  query?: string;
  year?: number;
  subject?: string;
  area?: string;
  difficulty?: DifficultyLevel | string;
  minSimilarity?: number;
  limit?: number;
  page?: number;
}

export interface QuestionSearchResult {
  id: string;
  year: number;
  area: string;
  subject: string;
  difficulty: string | null;
  text: string;
  options: Prisma.JsonValue;
  correctAnswer: number;
  explanation: string | null;
  errorRate: number | null;
  similarity?: number | null;
}

export class SearchService {
  /**
   * Constrói as cláusulas WHERE parametrizadas (Prisma.Sql) para filtros exatos:
   * - ano (`year`)
   * - disciplina (`subject` ou `area`, compatível com `2015_COMPLETO.json` e `materias.json`)
   * - área do conhecimento (`area`)
   * - dificuldade (`difficulty` explícita ou inferida pela taxa de erro `errorRate` do ENEM)
   */
  private buildExactFilterConditions(
    params: QuestionSearchParams
  ): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [Prisma.sql`1 = 1`];

    if (params.year !== undefined && !Number.isNaN(Number(params.year))) {
      const year = Number(params.year);
      conditions.push(Prisma.sql`q.year = ${year}`);
    }

    if (params.area && params.area.trim()) {
      const area = params.area.trim().toLowerCase();
      conditions.push(Prisma.sql`LOWER(q.area) = ${area}`);
    }

    if (params.subject && params.subject.trim()) {
      const subject = params.subject.trim().toLowerCase();
      // Em 2015_COMPLETO.json o campo `area` guarda "linguagens", "ciencias-humanas", etc.
      // e `subject` guarda "Geral" ou o slug/nome da disciplina de `materias.json`.
      conditions.push(
        Prisma.sql`(LOWER(q.subject) = ${subject} OR LOWER(q.area) = ${subject})`
      );
    }

    if (params.difficulty && params.difficulty.trim()) {
      const diff = params.difficulty.trim().toUpperCase();

      if (diff === "EASY" || diff === "FACIL" || diff === "FÁCIL") {
        conditions.push(
          Prisma.sql`(UPPER(COALESCE(q.difficulty, '')) IN ('EASY', 'FACIL', 'FÁCIL') OR (q.difficulty IS NULL AND q."errorRate" IS NOT NULL AND q."errorRate" < 45))`
        );
      } else if (diff === "MEDIUM" || diff === "MEDIO" || diff === "MÉDIO") {
        conditions.push(
          Prisma.sql`(UPPER(COALESCE(q.difficulty, '')) IN ('MEDIUM', 'MEDIO', 'MÉDIO') OR (q.difficulty IS NULL AND q."errorRate" IS NOT NULL AND q."errorRate" >= 45 AND q."errorRate" <= 70))`
        );
      } else if (diff === "HARD" || diff === "DIFICIL" || diff === "DIFÍCIL") {
        conditions.push(
          Prisma.sql`(UPPER(COALESCE(q.difficulty, '')) IN ('HARD', 'DIFICIL', 'DIFÍCIL') OR (q.difficulty IS NULL AND q."errorRate" IS NOT NULL AND q."errorRate" > 70))`
        );
      } else {
        conditions.push(Prisma.sql`UPPER(q.difficulty) = ${diff}`);
      }
    }

    return conditions;
  }

  /**
   * Motor de Busca Híbrido (Semântico via pgvector + Filtros Exatos):
   * - Se `query` for fornecido, gera o embedding da consulta via Gemini API e ordena
   *   pela distância de cosseno (`<=>`) no PostgreSQL com `pgvector`.
   * - Aplica filtros exatos de `year`, `subject`, `area` e `difficulty`.
   */
  async searchQuestions(params: QuestionSearchParams) {
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const page = Math.max(Number(params.page) || 1, 1);
    const offset = (page - 1) * limit;
    const minSimilarity =
      params.minSimilarity !== undefined ? Number(params.minSimilarity) : 0.25;

    const filterConditions = this.buildExactFilterConditions(params);
    const hasSemanticQuery = Boolean(params.query && params.query.trim());

    // 1. Caso haja texto de busca, executamos a busca semântica vetorial (pgvector)
    if (hasSemanticQuery) {
      const searchText = params.query!.trim();

      try {
        const queryVector = await embeddingService.generateQueryEmbedding(
          searchText
        );
        const vectorLiteral = embeddingService.toPgVectorLiteral(queryVector);

        const vectorConditions = [
          ...filterConditions,
          Prisma.sql`q.embedding IS NOT NULL`,
          Prisma.sql`(1 - (q.embedding <=> ${vectorLiteral}::vector)) >= ${minSimilarity}`,
        ];

        const results = await basePrisma.$queryRaw<QuestionSearchResult[]>`
          SELECT
            q.id,
            q.year,
            q.area,
            q.subject,
            q.difficulty,
            q.text,
            q.options,
            q."correctAnswer",
            q.explanation,
            q."errorRate",
            ROUND((1 - (q.embedding <=> ${vectorLiteral}::vector))::numeric, 4)::float AS similarity
          FROM "Question" q
          WHERE ${Prisma.join(vectorConditions, " AND ")}
          ORDER BY q.embedding <=> ${vectorLiteral}::vector ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `;

        // Se encontrou resultados vetoriais, retorna imediatamente com o score de similaridade
        if (results.length > 0) {
          return {
            mode: "semantic_vector",
            page,
            limit,
            count: results.length,
            results,
          };
        }
      } catch (error) {
        console.warn(
          "[SearchService] Fallback textual acionado (pgvector/Gemini indisponível ou sem embeddings indexados):",
          error instanceof Error ? error.message : error
        );
      }

      // Fallback textual caso as questões ainda não tenham embeddings populados ou GEMINI_API_KEY não esteja ativa
      const likePattern = `%${searchText}%`;
      const textFallbackConditions = [
        ...filterConditions,
        Prisma.sql`(q.text ILIKE ${likePattern} OR q.subject ILIKE ${likePattern} OR q.area ILIKE ${likePattern})`,
      ];

      const fallbackResults = await basePrisma.$queryRaw<QuestionSearchResult[]>`
        SELECT
          q.id,
          q.year,
          q.area,
          q.subject,
          q.difficulty,
          q.text,
          q.options,
          q."correctAnswer",
          q.explanation,
          q."errorRate",
          NULL::float AS similarity
        FROM "Question" q
        WHERE ${Prisma.join(textFallbackConditions, " AND ")}
        ORDER BY q.year DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      return {
        mode: "textual_fallback",
        page,
        limit,
        count: fallbackResults.length,
        results: fallbackResults,
      };
    }

    // 2. Busca apenas com filtros exatos (sem query semântica)
    const filteredResults = await basePrisma.$queryRaw<QuestionSearchResult[]>`
      SELECT
        q.id,
        q.year,
        q.area,
        q.subject,
        q.difficulty,
        q.text,
        q.options,
        q."correctAnswer",
        q.explanation,
        q."errorRate",
        NULL::float AS similarity
      FROM "Question" q
      WHERE ${Prisma.join(filterConditions, " AND ")}
      ORDER BY q.year DESC, q."errorRate" DESC NULLS LAST
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return {
      mode: "exact_filters",
      page,
      limit,
      count: filteredResults.length,
      results: filteredResults,
    };
  }

  /**
   * Gera e persiste embeddings em lote para questões existentes no banco
   * que ainda estejam com `embedding IS NULL`.
   */
  async backfillQuestionEmbeddings(batchSize = 20) {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      throw new AppError(
        "Configure a variável GEMINI_API_KEY no arquivo .env antes de indexar os embeddings.",
        400
      );
    }

    const safeBatchSize = Math.min(Math.max(Number(batchSize) || 20, 1), 100);

    const questionsWithoutEmbedding = await basePrisma.$queryRaw<
      Array<{
        id: string;
        text: string;
        subject: string;
        area: string;
        year: number;
        difficulty: string | null;
        options: Prisma.JsonValue;
        explanation: string | null;
      }>
    >`
      SELECT id, text, subject, area, year, difficulty, options, explanation
      FROM "Question"
      WHERE embedding IS NULL
      LIMIT ${safeBatchSize}
    `;

    let indexedCount = 0;

    for (const q of questionsWithoutEmbedding) {
      const vector = await embeddingService.generateQuestionEmbedding({
        text: q.text,
        subject: q.subject,
        area: q.area,
        year: q.year,
        difficulty: q.difficulty,
        options: q.options,
        explanation: q.explanation,
      });

      const vectorLiteral = embeddingService.toPgVectorLiteral(vector);

      await basePrisma.$executeRaw`
        UPDATE "Question"
        SET embedding = ${vectorLiteral}::vector
        WHERE id = ${q.id}
      `;

      indexedCount++;
    }

    return {
      indexedCount,
      remainingBatchCandidateCount: questionsWithoutEmbedding.length,
      message: `${indexedCount} questões indexadas com sucesso via Google Gemini Embeddings.`,
    };
  }
}

export const searchService = new SearchService();

