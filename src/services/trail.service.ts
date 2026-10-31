import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";
import { streakService } from "./streak.service";

export interface CreateTrailInput {
  title: string;
  description?: string;
  area: string;
  subjectId?: string;
  lessonIds?: string[];
  questionIds?: string[];
  totalSteps?: number;
}

export interface UpdateTrailInput {
  title?: string;
  description?: string;
  area?: string;
  subjectId?: string | null;
  lessonIds?: string[];
  questionIds?: string[];
  totalSteps?: number;
}

export interface UpdateTrailProgressInput {
  userId: string;
  trailId: string;
  completedSteps?: number;
  completedLessonIds?: string[];
  lessonId?: string;
  status?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
}

export class TrailService {
  async listTrails(userId?: string, area?: string) {
    const trails = await prisma.trail.findMany({
      where: area ? { area: { equals: area, mode: "insensitive" } } : undefined,
      include: {
        subject: { select: { id: true, name: true, slug: true, icon: true } },
        progresses: userId
          ? { where: { userId } }
          : false,
      },
      orderBy: { createdAt: "desc" },
    });

    return trails.map((trail) => {
      const userProgress = Array.isArray(trail.progresses)
        ? trail.progresses[0] || null
        : null;

      return {
        ...trail,
        userProgress,
      };
    });
  }

  async getTrailById(id: string, userId?: string) {
    const trail = await prisma.trail.findUnique({
      where: { id },
      include: {
        subject: true,
        progresses: userId ? { where: { userId } } : false,
      },
    });

    if (!trail) {
      throw new AppError("Trilha de estudo não encontrada.", 404);
    }

    const lessons =
      trail.lessonIds.length > 0
        ? await prisma.lesson.findMany({
            where: { id: { in: trail.lessonIds } },
            select: { id: true, title: true, subjectId: true },
          })
        : [];

    const userProgress = Array.isArray(trail.progresses)
      ? trail.progresses[0] || null
      : null;

    return {
      ...trail,
      lessons,
      userProgress,
    };
  }

  async createTrail(data: CreateTrailInput) {
    const {
      title,
      description,
      area,
      subjectId,
      lessonIds = [],
      questionIds = [],
      totalSteps,
    } = data;

    if (!title?.trim() || !area?.trim()) {
      throw new AppError("Título e área da trilha são obrigatórios.", 400);
    }

    const computedSteps =
      totalSteps ?? Math.max(lessonIds.length + questionIds.length, 1);

    return prisma.trail.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        area: area.trim(),
        subjectId: subjectId || null,
        lessonIds,
        questionIds,
        totalSteps: computedSteps,
      },
    });
  }

  async updateTrail(id: string, data: UpdateTrailInput) {
    await this.getTrailById(id);

    return prisma.trail.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.area !== undefined ? { area: data.area.trim() } : {}),
        ...(data.subjectId !== undefined ? { subjectId: data.subjectId } : {}),
        ...(data.lessonIds !== undefined ? { lessonIds: data.lessonIds } : {}),
        ...(data.questionIds !== undefined
          ? { questionIds: data.questionIds }
          : {}),
        ...(data.totalSteps !== undefined
          ? { totalSteps: data.totalSteps }
          : {}),
      },
    });
  }

  async deleteTrail(id: string) {
    await this.getTrailById(id);

    await prisma.trail.delete({
      where: { id },
    });

    return { message: "Trilha excluída com sucesso." };
  }

  /**
   * Atualiza ou cria o avanço do aluno (`TrailProgress`) em uma trilha
   * e atualiza a ofensiva caso uma etapa seja concluída.
   */
  async upsertProgress(input: UpdateTrailProgressInput) {
    const {
      userId,
      trailId,
      completedSteps,
      completedLessonIds,
      lessonId,
      status,
    } = input;

    if (!userId || !trailId) {
      throw new AppError("Os campos userId e trailId são obrigatórios.", 400);
    }

    const trail = await prisma.trail.findUnique({ where: { id: trailId } });
    if (!trail) {
      throw new AppError("Trilha não encontrada.", 404);
    }

    const existing = await prisma.trailProgress.findUnique({
      where: {
        userId_trailId: { userId, trailId },
      },
    });

    let updatedLessons = existing?.completedLessonIds || [];
    if (Array.isArray(completedLessonIds)) {
      updatedLessons = Array.from(new Set(completedLessonIds));
    } else if (lessonId && !updatedLessons.includes(lessonId)) {
      updatedLessons = [...updatedLessons, lessonId];
    }

    const newCompletedSteps =
      completedSteps !== undefined
        ? Number(completedSteps)
        : Math.max(updatedLessons.length, (existing?.completedSteps || 0) + 1);

    const totalSteps = Math.max(trail.totalSteps, 1);
    const progressPercent = Number(
      Math.min((newCompletedSteps / totalSteps) * 100, 100).toFixed(1)
    );

    const computedStatus =
      status ||
      (progressPercent >= 100
        ? "COMPLETED"
        : progressPercent > 0
        ? "IN_PROGRESS"
        : "NOT_STARTED");

    const progress = await prisma.trailProgress.upsert({
      where: {
        userId_trailId: { userId, trailId },
      },
      create: {
        userId,
        trailId,
        completedSteps: newCompletedSteps,
        completedLessonIds: updatedLessons,
        progressPercent,
        status: computedStatus,
      },
      update: {
        completedSteps: newCompletedSteps,
        completedLessonIds: updatedLessons,
        progressPercent,
        status: computedStatus,
      },
      include: {
        trail: { select: { id: true, title: true, area: true, totalSteps: true } },
      },
    });

    // Registra a atividade na ofensiva do aluno
    await streakService.registerActivity(userId).catch(() => null);

    return progress;
  }

  async listUserProgress(userId: string) {
    if (!userId) {
      throw new AppError("O userId é obrigatório.", 400);
    }

    return prisma.trailProgress.findMany({
      where: { userId },
      include: {
        trail: {
          include: {
            subject: { select: { id: true, name: true, slug: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
}

export const trailService = new TrailService();

