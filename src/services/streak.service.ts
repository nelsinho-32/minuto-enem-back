import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function startOfDayUTC(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function getDaysDifference(dateA: Date, dateB: Date): number {
  const startA = startOfDayUTC(dateA).getTime();
  const startB = startOfDayUTC(dateB).getTime();
  return Math.floor((startA - startB) / MS_PER_DAY);
}

export class StreakService {
  /**
   * Regra de Atividade (Conclusão de Aula ou Resolução de Questão):
   * - Incrementa o `currentStreak` em 1
   * - Reseta o `iceFreezes` para 0
   * - Atualiza o `longestStreak` se a ofensiva atual o superar
   * - Define o `lastStudyDate` para a data/hora de hoje
   */
  async registerActivity(userId: string) {
    if (!userId) {
      throw new AppError("O ID do usuário é obrigatório.", 400);
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError("Usuário não encontrado.", 404);
      }

      const now = new Date();
      const newCurrentStreak = user.currentStreak + 1;
      const newLongestStreak = Math.max(newCurrentStreak, user.longestStreak);

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          currentStreak: newCurrentStreak,
          iceFreezes: 0,
          longestStreak: newLongestStreak,
          lastStudyDate: now,
        },
        select: {
          id: true,
          currentStreak: true,
          longestStreak: true,
          iceFreezes: true,
          lastStudyDate: true,
          xp: true,
        },
      });

      return {
        ...updatedUser,
        streakIncremented: true,
        message: "Atividade registrada! Ofensiva incrementada e iceFreezes zerado.",
      };
    });
  }

  /**
   * Alias de compatibilidade para conclusão de aula
   */
  async completeLesson(userId: string) {
    return this.registerActivity(userId);
  }

  /**
   * Regra de Inatividade (Verificação no Login):
   * - Se o usuário não estudou no dia anterior (`diffInDays > 1`),
   *   incrementa o `iceFreezes` em 1.
   * - Se o `iceFreezes` for maior que 2 (`newIceFreezes > 2`),
   *   reseta o `currentStreak` para 0.
   */
  async verifyStreakOnLogin(userId: string) {
    if (!userId) {
      throw new AppError("O ID do usuário é obrigatório.", 400);
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError("Usuário não encontrado.", 404);
      }

      // Se o usuário nunca estudou antes, mantém o estado inicial
      if (!user.lastStudyDate) {
        return {
          id: user.id,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          iceFreezes: user.iceFreezes,
          lastStudyDate: user.lastStudyDate,
          missedDays: 0,
          iceFreezesUsed: 0,
          streakReset: false,
        };
      }

      const today = new Date();
      const diffInDays = getDaysDifference(today, user.lastStudyDate);

      // Estudou hoje (0) ou estudou ontem (1): manteve a atividade em dia
      if (diffInDays <= 1) {
        return {
          id: user.id,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          iceFreezes: user.iceFreezes,
          lastStudyDate: user.lastStudyDate,
          missedDays: 0,
          iceFreezesUsed: 0,
          streakReset: false,
        };
      }

      // Não estudou no dia anterior: incrementa iceFreezes em 1
      const newIceFreezes = user.iceFreezes + 1;
      const shouldResetStreak = newIceFreezes > 2;
      const newCurrentStreak = shouldResetStreak ? 0 : user.currentStreak;

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          iceFreezes: newIceFreezes,
          currentStreak: newCurrentStreak,
        },
        select: {
          id: true,
          currentStreak: true,
          longestStreak: true,
          iceFreezes: true,
          lastStudyDate: true,
        },
      });

      return {
        ...updatedUser,
        missedDays: diffInDays - 1,
        iceFreezesUsed: 1,
        streakReset: shouldResetStreak,
      };
    });
  }

  /**
   * Job Diário (Cron) para processar a regra de inatividade de todos os usuários:
   * - Verifica quem não estudou no dia anterior
   * - Incrementa `iceFreezes` em 1 e, se `iceFreezes > 2`, reseta `currentStreak` para 0
   */
  async processDailyInactivityJob() {
    const today = new Date();
    const users = await prisma.user.findMany({
      where: {
        lastStudyDate: { not: null },
      },
    });

    for (const user of users) {
      if (!user.lastStudyDate) continue;

      const diffInDays = getDaysDifference(today, user.lastStudyDate);
      if (diffInDays > 1) {
        const newIceFreezes = user.iceFreezes + 1;
        const newCurrentStreak = newIceFreezes > 2 ? 0 : user.currentStreak;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            iceFreezes: newIceFreezes,
            currentStreak: newCurrentStreak,
          },
        });
      }
    }
  }
}

export const streakService = new StreakService();
