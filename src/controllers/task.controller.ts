import { Request, Response } from "express";
import { taskService } from "../services/task.service";
import { AppError } from "../errors/AppError";

export class TaskController {
  async list(req: Request, res: Response): Promise<Response> {
    try {
      const classId = (req.params.classId ||
        req.query.classId ||
        req.query.classroomId) as string | undefined;

      const tasks = await taskService.listTasks(classId);
      return res.status(200).json(tasks);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async getById(req: Request, res: Response): Promise<Response> {
    try {
      const task = await taskService.getTaskById(req.params.id as string);
      return res.status(200).json(task);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async create(req: Request, res: Response): Promise<Response> {
    try {
      const task = await taskService.createTask(req.body);
      return res.status(201).json(task);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const task = await taskService.updateTask(
        req.params.id as string,
        req.body
      );
      return res.status(200).json(task);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async delete(req: Request, res: Response): Promise<Response> {
    try {
      const result = await taskService.deleteTask(req.params.id as string);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  private handleError(error: unknown, res: Response): Response {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error("[TaskController Error]:", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao gerenciar tarefas da turma." });
  }
}

export const taskController = new TaskController();

