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

  /**
   * Copiloto Docente:
   * Agrega os dados de erros da turma, diagnostica as maiores lacunas de aprendizado
   * e gera automaticamente uma Task de reforço pendente de aprovação do professor.
   */
  async generateCopilotAnalyticsAndTask(
    classroomId: string,
    teacherId?: string
  ) {
    if (!classroomId) {
      throw new AppError("O ID da sala (classroomId) é obrigatório.", 400);
    }

    const classroom = await prisma.classroom.findUnique({
      where: { id: classroomId },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        students: {
          select: {
            id: true,
            name: true,
            email: true,
            xp: true,
            currentStreak: true,
          },
        },
      },
    });

    if (!classroom) {
      throw new AppError("Sala de aula não encontrada.", 404);
    }

    if (teacherId && classroom.teacherId !== teacherId) {
      throw new AppError(
        "Acesso negado. Apenas o professor responsável pela sala pode acessar o Copiloto.",
        403
      );
    }

    const studentIds = classroom.students.map((s) => s.id);

    if (studentIds.length === 0) {
      return {
        classroom: {
          id: classroom.id,
          name: classroom.name,
          code: classroom.code,
          totalStudents: 0,
        },
        overview: {
          totalAttempts: 0,
          totalErrors: 0,
          accuracyPercent: 0,
          message: "Nenhum aluno matriculado na turma ainda.",
        },
        learningGaps: [],
        hardestQuestions: [],
        studentsNeedingSupport: [],
        generatedReinforcementTask: null,
      };
    }

    // Coleta todas as tentativas de resolução de questões feitas pelos alunos da turma
    const attempts = await prisma.questionAttempt.findMany({
      where: {
        userId: { in: studentIds },
      },
      include: {
        question: {
          select: {
            id: true,
            year: true,
            area: true,
            subject: true,
            text: true,
            errorRate: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalAttempts = attempts.length;
    const errorAttempts = attempts.filter((a) => !a.isCorrect);
    const correctAttempts = attempts.filter((a) => a.isCorrect);
    const accuracyPercent =
      totalAttempts > 0
        ? Number(((correctAttempts.length / totalAttempts) * 100).toFixed(1))
        : 0;

    // 1. Agrupamento de lacunas por disciplina/área
    const gapsBySubjectMap = new Map<
      string,
      {
        subject: string;
        area: string;
        errorCount: number;
        totalCount: number;
      }
    >();

    for (const att of attempts) {
      const subjectName = att.question.subject || "Geral";
      const current = gapsBySubjectMap.get(subjectName) || {
        subject: subjectName,
        area: att.question.area || "Geral",
        errorCount: 0,
        totalCount: 0,
      };

      current.totalCount += 1;
      if (!att.isCorrect) {
        current.errorCount += 1;
      }
      gapsBySubjectMap.set(subjectName, current);
    }

    const learningGaps = Array.from(gapsBySubjectMap.values())
      .map((g) => ({
        ...g,
        errorRatePercent:
          g.totalCount > 0
            ? Number(((g.errorCount / g.totalCount) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.errorCount - a.errorCount);

    // 2. Ranking das questões mais erradas pelos alunos da turma
    const questionErrorCountMap = new Map<
      string,
      {
        questionId: string;
        text: string;
        subject: string;
        area: string;
        nationalErrorRate: number | null;
        classErrorCount: number;
        classTotalAttempts: number;
      }
    >();

    for (const att of attempts) {
      const q = att.question;
      const current = questionErrorCountMap.get(q.id) || {
        questionId: q.id,
        text: q.text.slice(0, 160) + "...",
        subject: q.subject,
        area: q.area,
        nationalErrorRate: q.errorRate,
        classErrorCount: 0,
        classTotalAttempts: 0,
      };

      current.classTotalAttempts += 1;
      if (!att.isCorrect) {
        current.classErrorCount += 1;
      }
      questionErrorCountMap.set(q.id, current);
    }

    const hardestQuestions = Array.from(questionErrorCountMap.values())
      .filter((q) => q.classErrorCount > 0)
      .map((q) => ({
        ...q,
        classErrorRatePercent: Number(
          ((q.classErrorCount / q.classTotalAttempts) * 100).toFixed(1)
        ),
      }))
      .sort((a, b) => b.classErrorCount - a.classErrorCount)
      .slice(0, 10);

    // 3. Alunos com maior índice de erros (atenção pedagógica individualizada)
    const studentErrorMap = new Map<
      string,
      {
        userId: string;
        name: string;
        errorCount: number;
        totalAttempts: number;
      }
    >();

    const studentNameMap = new Map(classroom.students.map((s) => [s.id, s.name]));

    for (const att of attempts) {
      const current = studentErrorMap.get(att.userId) || {
        userId: att.userId,
        name: studentNameMap.get(att.userId) || "Aluno",
        errorCount: 0,
        totalAttempts: 0,
      };

      current.totalAttempts += 1;
      if (!att.isCorrect) {
        current.errorCount += 1;
      }
      studentErrorMap.set(att.userId, current);
    }

    const studentsNeedingSupport = Array.from(studentErrorMap.values())
      .map((s) => ({
        ...s,
        errorRatePercent:
          s.totalAttempts > 0
            ? Number(((s.errorCount / s.totalAttempts) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.errorRatePercent - a.errorRatePercent)
      .slice(0, 5);

    // 4. Geração Automática de Task de Reforço com as questões mais erradas
    let generatedTask = null;

    if (hardestQuestions.length > 0) {
      const primaryDeficit = learningGaps[0];
      const targetSubject = primaryDeficit?.subject || "Geral";
      const targetArea = primaryDeficit?.area || "Todas";

      const reinforcementQuestionIds = hardestQuestions
        .slice(0, 5)
        .map((q) => q.questionId);

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7); // Prazo padrão de 7 dias

      const taskTitle = `Reforço Focado: ${targetSubject} (${targetArea})`;
      const taskDescription = `[Copiloto Docente - Sugestão Automática] Identificamos que a turma apresentou ${primaryDeficit?.errorCount} erro(s) em ${targetSubject} (${primaryDeficit?.errorRatePercent}% de erro). Esta lista traz as questões de maior incidência de distratores para nivelamento e consolidação de habilidades.`;

      generatedTask = await prisma.task.create({
        data: {
          title: taskTitle,
          topic: `Reforço: ${targetSubject}`,
          description: taskDescription,
          total: reinforcementQuestionIds.length,
          questionIds: reinforcementQuestionIds,
          dueDate,
          status: "PENDING_APPROVAL",
          classId: classroom.code,
          classroomId: classroom.id,
        },
        include: {
          classroom: {
            select: { id: true, name: true, code: true },
          },
        },
      });
    }

    return {
      classroom: {
        id: classroom.id,
        name: classroom.name,
        code: classroom.code,
        totalStudents: classroom.students.length,
        teacher: classroom.teacher,
      },
      overview: {
        totalAttempts,
        totalErrors: errorAttempts.length,
        totalCorrect: correctAttempts.length,
        accuracyPercent,
      },
      learningGaps,
      hardestQuestions,
      studentsNeedingSupport,
      generatedReinforcementTask: generatedTask,
    };
  }

  /**
   * Aprovação de uma tarefa gerada pelo Copiloto Docente.
   */
  async approveTask(taskId: string, teacherId?: string) {
    if (!taskId) {
      throw new AppError("O ID da tarefa é obrigatório.", 400);
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { classroom: true },
    });

    if (!task) {
      throw new AppError("Tarefa não encontrada.", 404);
    }

    if (
      teacherId &&
      task.classroom &&
      task.classroom.teacherId !== teacherId
    ) {
      throw new AppError(
        "Apenas o professor criador da sala pode aprovar esta tarefa.",
        403
      );
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "APPROVED",
      },
    });

    return {
      message: "Tarefa de reforço aprovada e publicada para a turma com sucesso!",
      task: updated,
    };
  }
}

export const classroomService = new ClassroomService();

