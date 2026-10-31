import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 768;

export interface QuestionEmbeddingPayload {
  text: string;
  subject?: string | null;
  area?: string | null;
  year?: number | null;
  difficulty?: string | null;
  options?: unknown;
  explanation?: string | null;
}

export class EmbeddingService {
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Variável de ambiente GEMINI_API_KEY não configurada para geração de embeddings."
      );
    }

    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey });
    }

    return this.client;
  }

  /**
   * Monta o documento textual enriquecido de uma questão (enunciado + área/disciplina + alternativas + resolução)
   * para maximizar a qualidade da representação vetorial.
   */
  buildQuestionDocument(question: QuestionEmbeddingPayload): string {
    const parts: string[] = [];

    if (question.area) parts.push(`Área: ${question.area}`);
    if (question.subject) parts.push(`Disciplina: ${question.subject}`);
    if (question.year) parts.push(`Ano ENEM: ${question.year}`);
    if (question.difficulty) parts.push(`Dificuldade: ${question.difficulty}`);

    parts.push(`Enunciado:\n${question.text}`);

    if (Array.isArray(question.options) && question.options.length > 0) {
      parts.push(`Alternativas:\n${question.options.join("\n")}`);
    }

    if (
      question.explanation &&
      question.explanation !== "Resolução indisponível no momento."
    ) {
      parts.push(`Explicação:\n${question.explanation}`);
    }

    return parts.join("\n\n");
  }

  /**
   * Gera um vetor de embedding (768 dimensões) para um texto usando a API do Google Gemini (`gemini-embedding-2`).
   */
  async generateEmbedding(content: string): Promise<number[]> {
    const ai = this.getClient();

    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: content,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error("A API do Gemini não retornou valores de embedding.");
    }

    return values;
  }

  /**
   * Gera o embedding semântico completo para uma questão do ENEM.
   */
  async generateQuestionEmbedding(
    question: QuestionEmbeddingPayload
  ): Promise<number[]> {
    const documentText = this.buildQuestionDocument(question);
    return this.generateEmbedding(documentText);
  }

  /**
   * Gera o embedding para uma consulta de busca do usuário.
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.generateEmbedding(query.trim());
  }

  /**
   * Converte um array numérico para a representação textual aceita pelo tipo `vector(768)` do pgvector.
   */
  toPgVectorLiteral(embedding: number[]): string {
    const sanitized = embedding.map((v) =>
      Number.isFinite(v) ? Number(v) : 0
    );
    return `[${sanitized.join(",")}]`;
  }
}

export const embeddingService = new EmbeddingService();

