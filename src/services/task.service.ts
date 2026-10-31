import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";

export interface CreateTaskInput {
  title?: string;
  description?: string;
  topic: string;
  total?: number;
  questionIds?: string[];
  dueDate?: string | Date;
  classId?: string;
  classroomId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  topic?: string;
  total?: number;
  questionIds?: string[];
  dueDate?: string | Date | null;
  classId?: string;
  classroomId?: string | null;
}

export class TaskService {
  async listTasks(classId?: string) {
    return prisma.task.findMany({
      where: classId
        ? {
            OR: [{ classId }, { classroomId: classId }],
          }
        : undefined,
      include: {
        classroom: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getTaskById(id: string) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        classroom: {
          select: { id: true, name: true, code: true, teacherId: true },
        },
      },
    });

    if (!task) {
      throw new AppError("Tarefa não encontrada.", 404);
    }

    const questions =
      task.questionIds.length > 0
        ? await prisma.question.findMany({
            where: { id: { in: task.questionIds } },
          })
        : [];

    return {
      ...task,
      questions,
    };
  }

  async createTask(data: CreateTaskInput) {
    const {
      title,
      description,
      topic,
      total,
      questionIds = [],
      dueDate,
      classId,
      classroomId,
    } = data;

    const resolvedClassId = classId || classroomId;
    if (!resolvedClassId) {
      throw new AppError(
        "O ID da turma (classId ou classroomId) é obrigatório.",
        400
      );
    }

    const resolvedTopic = topic?.trim() || title?.trim();
    if (!resolvedTopic) {
      throw new AppError("O tópico ou título da tarefa é obrigatório.", 400);
    }

    // Verifica se o ID informado pertence a um Classroom registrado para vincular a FK opcional
    const classroomExists = await prisma.classroom.findUnique({
      where: { id: classroomId || resolvedClassId },
      select: { id: true },
    });

    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    if (parsedDueDate && Number.isNaN(parsedDueDate.getTime())) {
      throw new AppError("Formato de data de entrega (dueDate) inválido.", 400);
    }

    return prisma.task.create({
      data: {
        title: title?.trim() || resolvedTopic,
        description: description?.trim() || null,
        topic: resolvedTopic,
        total: total !== undefined ? Number(total) : questionIds.length,
        questionIds: Array.isArray(questionIds) ? questionIds : [],
        dueDate: parsedDueDate,
        classId: resolvedClassId,
        classroomId: classroomExists ? classroomExists.id : null,
      },
      include: {
        classroom: {
          select: { id: true, name: true, code: true },
        },
      },
    });
  }

  async updateTask(id: string, data: UpdateTaskInput) {
    await this.getTaskById(id);

    const parsedDueDate =
      data.dueDate === null
        ? null
        : data.dueDate !== undefined
        ? new Date(data.dueDate)
        : undefined;

    if (
      parsedDueDate instanceof Date &&
      Number.isNaN(parsedDueDate.getTime())
    ) {
      throw new AppError("Formato de data de entrega (dueDate) inválido.", 400);
    }

    return prisma.task.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.topic !== undefined ? { topic: data.topic.trim() } : {}),
        ...(data.total !== undefined ? { total: Number(data.total) } : {}),
        ...(data.questionIds !== undefined
          ? { questionIds: data.questionIds }
          : {}),
        ...(parsedDueDate !== undefined ? { dueDate: parsedDueDate } : {}),
        ...(data.classId !== undefined ? { classId: data.classId } : {}),
        ...(data.classroomId !== undefined
          ? { classroomId: data.classroomId }
          : {}),
      },
    });
  }

  async deleteTask(id: string) {
    await this.getTaskById(id);

    await prisma.task.delete({
      where: { id },
    });

    return { message: "Tarefa excluída com sucesso." };
  }
}

export const taskService = new TaskService();

