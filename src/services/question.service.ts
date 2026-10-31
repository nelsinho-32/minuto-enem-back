import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";

export interface AnswerQuestionInput {
  userId: string;
  questionId: string;
  selectedAnswer: number;
}

export class QuestionService {
  /**
   * Lista todas as questões ordenadas das mais recentes para as mais antigas.
   */
  async listQuestions(subject?: string, area?: string) {
    return prisma.question.findMany({
      where: {
        ...(subject ? { subject } : {}),
        ...(area ? { area } : {}),
      },
      orderBy: { year: "desc" },
    });
  }

  /**
   * Processa a resposta do aluno em `POST /questions/answer` e aplica a regra de atividade:
   * - Verifica se a alternativa escolhida está correta
   * - Registra a tentativa em `QuestionAttempt`
   * - Incrementa o `currentStreak` em 1 e reseta `iceFreezes` para 0
   * - Atualiza `longestStreak`, `lastStudyDate` e `xp`
   */
  async answerQuestion({
    userId,
    questionId,
    selectedAnswer,
  }: AnswerQuestionInput) {
    if (!userId) {
      throw new AppError("O ID do usuário (userId) é obrigatório.", 400);
    }

    if (!questionId) {
      throw new AppError("O ID da questão (questionId) é obrigatório.", 400);
    }

    if (
      selectedAnswer === undefined ||
      selectedAnswer === null ||
      Number.isNaN(Number(selectedAnswer))
    ) {
      throw new AppError(
        "A alternativa selecionada (selectedAnswer) é obrigatória.",
        400
      );
    }

    const numericAnswer = Number(selectedAnswer);

    return prisma.$transaction(async (tx) => {
      const [user, question] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.question.findUnique({ where: { id: questionId } }),
      ]);

      if (!user) {
        throw new AppError("Usuário não encontrado.", 404);
      }

      if (!question) {
        throw new AppError("Questão não encontrada.", 404);
      }

      const isCorrect = question.correctAnswer === numericAnswer;
      const xpEarned = isCorrect ? 10 : 0;

      // 1. Registra a tentativa de resolução da questão
      const attempt = await tx.questionAttempt.create({
        data: {
          userId: user.id,
          questionId: question.id,
          selectedAnswer: numericAnswer,
          isCorrect,
        },
      });

      // 2. Regra de atividade: incrementa currentStreak e reseta iceFreezes para 0
      const now = new Date();
      const newCurrentStreak = user.currentStreak + 1;
      const newLongestStreak = Math.max(newCurrentStreak, user.longestStreak);

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          currentStreak: newCurrentStreak,
          iceFreezes: 0,
          longestStreak: newLongestStreak,
          lastStudyDate: now,
          xp: { increment: xpEarned },
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          xp: true,
          currentStreak: true,
          longestStreak: true,
          iceFreezes: true,
          lastStudyDate: true,
        },
      });

      return {
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        xpEarned,
        attemptId: attempt.id,
        user: updatedUser,
        streak: {
          currentStreak: updatedUser.currentStreak,
          longestStreak: updatedUser.longestStreak,
          iceFreezes: updatedUser.iceFreezes,
          lastStudyDate: updatedUser.lastStudyDate,
        },
      };
    });
  }
}

export const questionService = new QuestionService();

