import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import "dotenv/config";
import { basePrisma } from "../lib/prisma";
import { embeddingService } from "../services/embedding.service";
import { aiService, EssayCorrectionInput } from "../services/ai.service";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_URL = process.env.REDIS_URL;

export interface EmbeddingJobData {
  questionId: string;
}

export interface OcrEssayJobData extends EssayCorrectionInput {
  userId?: string;
}

let isRedisAvailable = false;

export const redisConnection = REDIS_URL
  ? new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
    })
  : new IORedis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
    });

redisConnection.on("connect", () => {
  isRedisAvailable = true;
  console.log("🟢 [Redis / BullMQ] Conectado com sucesso ao Redis.");
});

redisConnection.on("error", () => {
  isRedisAvailable = false;
});

// ==========================================
// 1. FILAS BULLMQ (Embeddings e OCR/Redação)
// ==========================================

export const embeddingQueue = new Queue<EmbeddingJobData>("embedding-queue", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const ocrEssayQueue = new Queue<OcrEssayJobData>("ocr-essay-queue", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

embeddingQueue.on("error", () => {
  // Silencia erros de conexão caso o container Redis ainda não esteja iniciado
});

ocrEssayQueue.on("error", () => {
  // Silencia erros de conexão caso o container Redis ainda não esteja iniciado
});

/**
 * Executa a geração e persistência do embedding de uma questão no PostgreSQL (pgvector).
 */
export async function processQuestionEmbeddingJob(
  questionId: string
): Promise<void> {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return;
  }

  const question = await basePrisma.question.findUnique({
    where: { id: questionId },
  });

  if (!question || !question.text) {
    return;
  }

  const vector = await embeddingService.generateQuestionEmbedding({
    text: question.text,
    subject: question.subject,
    area: question.area,
    year: question.year,
    difficulty: question.difficulty,
    options: question.options,
    explanation: question.explanation,
  });

  const vectorLiteral = embeddingService.toPgVectorLiteral(vector);

  await basePrisma.$executeRaw`
    UPDATE "Question"
    SET embedding = ${vectorLiteral}::vector
    WHERE id = ${question.id}
  `;
}

// ==========================================
// 2. WORKERS EM BACKGROUND
// ==========================================

let embeddingWorker: Worker<EmbeddingJobData> | null = null;
let ocrEssayWorker: Worker<OcrEssayJobData> | null = null;

export function startBackgroundWorkers(): void {
  redisConnection.once("ready", () => {
    if (!embeddingWorker) {
      embeddingWorker = new Worker<EmbeddingJobData>(
        "embedding-queue",
        async (job: Job<EmbeddingJobData>) => {
          await processQuestionEmbeddingJob(job.data.questionId);
          return { questionId: job.data.questionId, indexed: true };
        },
        {
          connection: redisConnection as any,
          concurrency: 3,
        }
      );

      embeddingWorker.on("failed", (job, err) => {
        console.warn(
          `⚠️ [BullMQ Embedding Worker] Job ${job?.id} falhou:`,
          err.message
        );
      });
    }

    if (!ocrEssayWorker) {
      ocrEssayWorker = new Worker<OcrEssayJobData>(
        "ocr-essay-queue",
        async (job: Job<OcrEssayJobData>) => {
          const correction = await aiService.gradeEssay(job.data);
          return correction;
        },
        {
          connection: redisConnection as any,
          concurrency: 2,
        }
      );

      ocrEssayWorker.on("failed", (job, err) => {
        console.warn(
          `⚠️ [BullMQ OCR Essay Worker] Job ${job?.id} falhou:`,
          err.message
        );
      });
    }

    console.log(
      "⚙️ [BullMQ Workers] Filas assíncronas (embedding-queue e ocr-essay-queue) ativas!"
    );
  });
}

// ==========================================
// 3. PRODUCERS (Com Fallback Assíncrono Seguro)
// ==========================================

/**
 * Enfileira a geração de embedding de uma questão no BullMQ.
 * Se o Redis estiver indisponível localmente, executa de forma assíncrona não-bloqueante.
 */
export async function enqueueQuestionEmbedding(
  questionId: string
): Promise<void> {
  if (isRedisAvailable) {
    try {
      await embeddingQueue.add(
        "generate-question-embedding",
        { questionId },
        { jobId: `embedding_${questionId}_${Date.now()}` }
      );
      return;
    } catch {
      // Fallback abaixo caso ocorra falha de rede com o Redis
    }
  }

  setImmediate(() => {
    processQuestionEmbeddingJob(questionId).catch((err) => {
      console.warn(
        `[Fallback Embedding] Falha ao gerar embedding para ${questionId}:`,
        err instanceof Error ? err.message : err
      );
    });
  });
}

/**
 * Enfileira uma correção de redação com OCR em background no BullMQ.
 */
export async function enqueueEssayOcrCorrection(data: OcrEssayJobData) {
  if (!isRedisAvailable) {
    // Caso Redis esteja offline, processa diretamente e retorna o resultado
    const directResult = await aiService.gradeEssay(data);
    return {
      queued: false,
      status: "completed",
      result: directResult,
    };
  }

  const job = await ocrEssayQueue.add("grade-essay-ocr", data);
  return {
    queued: true,
    jobId: job.id,
    status: "queued",
    message:
      "Redação enviada para a fila de processamento assíncrono (OCR + IA).",
  };
}

/**
 * Consulta o status e o resultado de um job na fila de OCR/Redação.
 */
export async function getEssayOcrJobStatus(jobId: string) {
  const job = await ocrEssayQueue.getJob(jobId);
  if (!job) {
    return null;
  }

  const state = await job.getState();
  return {
    jobId: job.id,
    state,
    progress: job.progress,
    result: job.returnvalue ?? null,
    failedReason: job.failedReason ?? null,
  };
}

