import { Request, Response } from "express";
import { classroomService } from "../services/classroom.service";
import { AppError } from "../errors/AppError";

export class ClassroomController {
  /**
   * POST /api/classrooms
   * Requer middlewares: `authenticate` e `isTeacher`
   */
  async create(req: Request, res: Response): Promise<Response> {
    try {
      const { name, code } = req.body;
      const teacherId = req.user!.id;

      const classroom = await classroomService.createClassroom({
        name,
        code,
        teacherId,
      });

      return res.status(201).json(classroom);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * POST /api/classrooms/enroll
   * Requer middleware: `authenticate`
   */
  async enroll(req: Request, res: Response): Promise<Response> {
    try {
      const { code } = req.body;
      const studentId = req.user!.id;

      const classroom = await classroomService.enrollStudent(code, studentId);
      return res.status(200).json(classroom);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * GET / POST /api/classrooms/:id/copilot-analytics
   * Endpoint Analítico Avançado do Copiloto Docente:
   * Agrega os erros da turma, mapeia as lacunas e gera automaticamente uma lista de reforço (Task).
   * Requer: `auth` e `isTeacher`.
   */
  async copilotAnalytics(req: Request, res: Response): Promise<Response> {
    try {
      const classroomId = req.params.id as string;
      const teacherId = req.user?.id;

      const result = await classroomService.generateCopilotAnalyticsAndTask(
        classroomId,
        teacherId
      );

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  /**
   * PATCH / POST /api/classrooms/tasks/:taskId/approve
   * Aprova e publica a tarefa de reforço gerada pelo Copiloto Docente.
   * Requer: `auth` e `isTeacher`.
   */
  async approveTask(req: Request, res: Response): Promise<Response> {
    try {
      const taskId = req.params.taskId as string;
      const teacherId = req.user?.id;

      const result = await classroomService.approveTask(taskId, teacherId);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  private handleError(error: unknown, res: Response): Response {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    console.error("[ClassroomController Error]:", error);
    return res.status(500).json({
      error: "Erro interno ao gerenciar sala de aula.",
    });
  }
}

export const classroomController = new ClassroomController();

