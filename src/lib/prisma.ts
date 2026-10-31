import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const basePrisma = new PrismaClient({ adapter });

/**
 * Dispara o enfileiramento assíncrono no BullMQ (ou fallback não-bloqueante)
 * para gerar e gravar o embedding da questão via Google Gemini sem travar a requisição HTTP.
 */
async function triggerAsyncQuestionEmbedding(questionId: string): Promise<void> {
  try {
    const { enqueueQuestionEmbedding } = await import(
      "../queues/background.queue"
    );
    await enqueueQuestionEmbedding(questionId);
  } catch (error) {
    console.warn(
      `[Prisma Embedding Extension] Falha ao enfileirar embedding da questão ${questionId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Prisma Extension (Middleware moderno do Prisma):
 * Dispara automaticamente a fila de geração de embedding via Google Gemini (BullMQ)
 * sempre que uma questão for criada (`create`), atualizada (`update`) ou sofrer `upsert`.
 */
export const prisma = basePrisma.$extends({
  name: "gemini-question-embedding-extension",
  query: {
    question: {
      async create({ args, query }) {
        const result = await query(args);
        if (result?.id) {
          await triggerAsyncQuestionEmbedding(result.id);
        }
        return result;
      },
      async update({ args, query }) {
        const result = await query(args);
        if (result?.id) {
          await triggerAsyncQuestionEmbedding(result.id);
        }
        return result;
      },
      async upsert({ args, query }) {
        const result = await query(args);
        if (result?.id) {
          await triggerAsyncQuestionEmbedding(result.id);
        }
        return result;
      },
    },
  },
});
