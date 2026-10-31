import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";
import { streakService } from "./streak.service";
import { triService } from "./tri.service";

export interface SM2ReviewInput {
  userId: string;
  questionId: string;
  grade?: number; // 0 a 5 (escala oficial SuperMemo-2)
  isCorrect?: boolean; // alternativo para grade
}

export interface FlashcardItem {
  id: string;
  questionId: string;
  repetition: number;
  interval: number;
  easeFactor: number;
  nextReviewDate: Date;
  lastReviewedAt: Date | null;
  question: {
    id: string;
    year: number;
    area: string;
    subject: string;
    difficulty: string | null;
    text: string;
    options: unknown;
    correctAnswer: number;
    explanation: string | null;
    errorRate: number | null;
  };
  triMetrics?: any;
}

export class SpacedRepetitionService {
  /**
   * Calcula o próximo intervalo, repetições e facilidade segundo a fórmula clássica do SM-2 (SuperMemo-2).
   */
  calculateSM2(
    currentRepetition: number,
    currentInterval: number,
    currentEaseFactor: number,
    grade: number
  ) {
    const q = Math.max(0, Math.min(5, Math.round(grade)));

    // 1. Atualização do Fator de Facilidade (EF)
    // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    let newEaseFactor =
      currentEaseFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

    // O SM-2 estabelece piso mínimo de 1.3 para o Ease Factor
    if (newEaseFactor < 1.3) {
      newEaseFactor = 1.3;
    }

    newEaseFactor = Number(newEaseFactor.toFixed(4));

    let newRepetition: number;
    let newInterval: number;

    // 2. Cálculo do Intervalo (em dias) e Repetições Consecutivas
    if (q >= 3) {
      // Sucesso na recordação
      if (currentRepetition === 0) {
        newInterval = 1;
      } else if (currentRepetition === 1) {
        newInterval = 6;
      } else {
        newInterval = Math.round(
          Math.max(currentInterval, 1) * newEaseFactor
        );
      }
      newRepetition = currentRepetition + 1;
    } else {
      // Falha na recordação: reinicia a sequência de repetições
      newRepetition = 0;
      newInterval = 1;
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);

    return {
      repetition: newRepetition,
      interval: newInterval,
      easeFactor: newEaseFactor,
      nextReviewDate,
    };
  }

  /**
   * Sincroniza erros passados do aluno (`QuestionAttempt` com `isCorrect = false`)
   * criando flashcards de repetição espaçada caso ainda não existam.
   */
  async syncMistakesToFlashcards(userId: string): Promise<number> {
    if (!userId) {
      throw new AppError("O ID do usuário é obrigatório.", 400);
    }

    // Busca todas as questões que o aluno já errou
    const wrongAttempts = await prisma.questionAttempt.findMany({
      where: {
        userId,
        isCorrect: false,
      },
      select: { questionId: true },
      distinct: ["questionId"],
    });

    if (wrongAttempts.length === 0) {
      return 0;
    }

    const existingReviews = await prisma.flashcardReview.findMany({
      where: { userId },
      select: { questionId: true },
    });

    const existingSet = new Set(existingReviews.map((r) => r.questionId));
    const newQuestionsToCreate = wrongAttempts
      .map((a) => a.questionId)
      .filter((qId) => !existingSet.has(qId));

    if (newQuestionsToCreate.length === 0) {
      return 0;
    }

    await prisma.flashcardReview.createMany({
      data: newQuestionsToCreate.map((questionId) => ({
        userId,
        questionId,
        repetition: 0,
        interval: 0,
        easeFactor: 2.5,
        nextReviewDate: new Date(), // Imediatamente disponível para revisão hoje
      })),
      skipDuplicates: true,
    });

    return newQuestionsToCreate.length;
  }

  /**
   * Retorna a fila de flashcards programados para revisão hoje (`nextReviewDate <= now`).
   */
  async getDueFlashcards(
    userId: string,
    limit: number = 20
  ): Promise<{
    dueCount: number;
    cards: FlashcardItem[];
  }> {
    if (!userId) {
      throw new AppError("O ID do usuário é obrigatório.", 400);
    }

    // Garante que os erros passados estejam na fila
    await this.syncMistakesToFlashcards(userId);

    const now = new Date();

    const dueReviews = await prisma.flashcardReview.findMany({
      where: {
        userId,
        nextReviewDate: { lte: now },
      },
      include: {
        question: true,
      },
      orderBy: { nextReviewDate: "asc" },
      take: Math.min(Math.max(limit, 1), 100),
    });

    const cards: FlashcardItem[] = dueReviews.map((review) => {
      const triMetrics = triService.calculateQuestionWeight(
        review.question.errorRate,
        review.question.id
      );

      return {
        id: review.id,
        questionId: review.questionId,
        repetition: review.repetition,
        interval: review.interval,
        easeFactor: review.easeFactor,
        nextReviewDate: review.nextReviewDate,
        lastReviewedAt: review.lastReviewedAt,
        question: {
          id: review.question.id,
          year: review.question.year,
          area: review.question.area,
          subject: review.question.subject,
          difficulty: review.question.difficulty,
          text: review.question.text,
          options: review.question.options,
          correctAnswer: review.question.correctAnswer,
          explanation: review.question.explanation,
          errorRate: review.question.errorRate,
        },
        triMetrics,
      };
    });

    return {
      dueCount: cards.length,
      cards,
    };
  }

  /**
   * Processa a revisão de um flashcard pelo aluno aplicando o algoritmo SM-2
   * e computa a próxima data de revisão.
   */
  async reviewCard(input: SM2ReviewInput) {
    const { userId, questionId, grade, isCorrect } = input;

    if (!userId || !questionId) {
      throw new AppError("userId e questionId são obrigatórios.", 400);
    }

    // Normaliza nota de 0 a 5
    let calculatedGrade: number;
    if (grade !== undefined && grade !== null) {
      calculatedGrade = Number(grade);
    } else if (typeof isCorrect === "boolean") {
      calculatedGrade = isCorrect ? 4 : 1;
    } else {
      throw new AppError(
        "Informe a nota de recordação (grade: 0-5) ou se acertou (isCorrect: boolean).",
        400
      );
    }

    const existingCard = await prisma.flashcardReview.findUnique({
      where: {
        userId_questionId: { userId, questionId },
      },
    });

    const currentRep = existingCard?.repetition ?? 0;
    const currentInt = existingCard?.interval ?? 0;
    const currentEF = existingCard?.easeFactor ?? 2.5;

    const sm2Result = this.calculateSM2(
      currentRep,
      currentInt,
      currentEF,
      calculatedGrade
    );

    const updatedCard = await prisma.flashcardReview.upsert({
      where: {
        userId_questionId: { userId, questionId },
      },
      create: {
        userId,
        questionId,
        repetition: sm2Result.repetition,
        interval: sm2Result.interval,
        easeFactor: sm2Result.easeFactor,
        nextReviewDate: sm2Result.nextReviewDate,
        lastReviewedAt: new Date(),
      },
      update: {
        repetition: sm2Result.repetition,
        interval: sm2Result.interval,
        easeFactor: sm2Result.easeFactor,
        nextReviewDate: sm2Result.nextReviewDate,
        lastReviewedAt: new Date(),
      },
      include: {
        question: {
          select: { id: true, subject: true, area: true, errorRate: true },
        },
      },
    });

    // Registra a atividade diária para a ofensiva do aluno
    await streakService.registerActivity(userId).catch(() => null);

    return {
      message:
        sm2Result.repetition > 0
          ? `Ótimo! Próxima revisão agendada para daqui a ${sm2Result.interval} dia(s).`
          : "Item agendado para reforço amanhã.",
      sm2: sm2Result,
      card: updatedCard,
    };
  }

  /**
   * Estatísticas gerais do sistema de repetição espaçada do aluno.
   */
  async getStudentStats(userId: string) {
    if (!userId) {
      throw new AppError("O ID do usuário é obrigatório.", 400);
    }

    const now = new Date();

    const [totalCards, dueToday, masteredCards] = await Promise.all([
      prisma.flashcardReview.count({ where: { userId } }),
      prisma.flashcardReview.count({
        where: {
          userId,
          nextReviewDate: { lte: now },
        },
      }),
      prisma.flashcardReview.count({
        where: {
          userId,
          repetition: { gte: 3 },
        },
      }),
    ]);

    const learningCards = totalCards - masteredCards;

    return {
      userId,
      totalCards,
      dueToday,
      masteredCards,
      learningCards,
      retentionRatePercent:
        totalCards > 0
          ? Number(((masteredCards / totalCards) * 100).toFixed(1))
          : 0,
    };
  }
}

export const spacedRepetitionService = new SpacedRepetitionService();

