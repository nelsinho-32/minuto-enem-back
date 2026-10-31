import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";

export interface CreateNoteInput {
  userId: string;
  title: string;
  content: string;
  tags?: string[];
  lessonId?: string;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  tags?: string[];
  lessonId?: string | null;
}

export class NoteService {
  async listByUser(userId?: string, lessonId?: string) {
    return prisma.note.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(lessonId ? { lessonId } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getById(id: string) {
    const note = await prisma.note.findUnique({
      where: { id },
    });

    if (!note) {
      throw new AppError("Anotação não encontrada.", 404);
    }

    return note;
  }

  async create(data: CreateNoteInput) {
    const { userId, title, content, tags, lessonId } = data;

    if (!userId) {
      throw new AppError("O ID do usuário (userId) é obrigatório.", 400);
    }

    if (!title?.trim() || !content?.trim()) {
      throw new AppError("Título e conteúdo da anotação são obrigatórios.", 400);
    }

    return prisma.note.create({
      data: {
        userId,
        title: title.trim(),
        content: content.trim(),
        tags: Array.isArray(tags) ? tags : [],
        lessonId: lessonId || null,
      },
    });
  }

  async update(id: string, data: UpdateNoteInput) {
    await this.getById(id);

    return prisma.note.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.content !== undefined ? { content: data.content.trim() } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.lessonId !== undefined ? { lessonId: data.lessonId } : {}),
      },
    });
  }

  async delete(id: string) {
    await this.getById(id);

    await prisma.note.delete({
      where: { id },
    });

    return { message: "Anotação excluída com sucesso." };
  }
}

export const noteService = new NoteService();

