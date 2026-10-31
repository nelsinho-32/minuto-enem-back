import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { noteService } from "../services/note.service";
import { AppError } from "../errors/AppError";
import { JwtPayloadData } from "../middlewares/auth.middleware";

const JWT_SECRET = process.env.JWT_SECRET || "enem-super-secret-jwt-key-2026";

export class NoteController {
  private resolveUserId(req: Request): string | undefined {
    if (req.user?.id) return req.user.id;
    if (req.body?.userId) return String(req.body.userId);
    if (req.query?.userId) return String(req.query.userId);
    if (req.params?.userId) return String(req.params.userId);

    if (req.headers.authorization) {
      const [, token] = req.headers.authorization.split(" ");
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as JwtPayloadData;
          return decoded.sub;
        } catch {
          return undefined;
        }
      }
    }

    return undefined;
  }

  async list(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);
      const lessonId = req.query.lessonId as string | undefined;

      const notes = await noteService.listByUser(userId, lessonId);
      return res.status(200).json(notes);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async getById(req: Request, res: Response): Promise<Response> {
    try {
      const note = await noteService.getById(req.params.id as string);
      return res.status(200).json(note);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async create(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);
      const { title, content, tags, lessonId } = req.body;

      const note = await noteService.create({
        userId: userId as string,
        title,
        content,
        tags,
        lessonId,
      });

      return res.status(201).json(note);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const { title, content, tags, lessonId } = req.body;
      const note = await noteService.update(req.params.id as string, {
        title,
        content,
        tags,
        lessonId,
      });

      return res.status(200).json(note);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async delete(req: Request, res: Response): Promise<Response> {
    try {
      const result = await noteService.delete(req.params.id as string);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  private handleError(error: unknown, res: Response): Response {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error("[NoteController Error]:", error);
    return res.status(500).json({ error: "Erro interno ao gerenciar anotações." });
  }
}

export const noteController = new NoteController();

