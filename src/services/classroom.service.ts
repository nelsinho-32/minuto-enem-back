import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";

export interface CreateClassroomInput {
  name: string;
  teacherId: string;
  code?: string;
}

export class ClassroomService {
  /**
   * Cria uma nova sala (Classroom) vinculada ao professor criador (1:N).
   */
  async createClassroom({ name, teacherId, code }: CreateClassroomInput) {
    if (!name || !name.trim()) {
      throw new AppError("O nome da sala é obrigatório.", 400);
    }

    const roomCode = code
      ? code.trim().toUpperCase()
      : crypto.randomBytes(3).toString("hex").toUpperCase();

    const existingCode = await prisma.classroom.findUnique({
      where: { code: roomCode },
    });

    if (existingCode) {
      throw new AppError("Já existe uma sala com este código.", 409);
    }

    const classroom = await prisma.classroom.create({
      data: {
        name: name.trim(),
        code: roomCode,
        teacherId,
      },
      include: {
        teacher: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: { students: true },
        },
      },
    });

    return classroom;
  }

  /**
   * Matricula um aluno na sala (relação N:N) através do código da sala.
   */
  async enrollStudent(code: string, studentId: string) {
    if (!code) {
      throw new AppError("O código da sala é obrigatório.", 400);
    }

    const classroom = await prisma.classroom.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    if (!classroom) {
      throw new AppError("Sala não encontrada.", 404);
    }

    const updatedClassroom = await prisma.classroom.update({
      where: { id: classroom.id },
      data: {
        students: {
          connect: { id: studentId },
        },
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true },
        },
        students: {
          select: { id: true, name: true, email: true, xp: true, currentStreak: true },
        },
      },
    });

    return updatedClassroom;
  }
}

export const classroomService = new ClassroomService();

