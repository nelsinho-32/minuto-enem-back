import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { trailService } from "../services/trail.service";
import { AppError } from "../errors/AppError";
import { JwtPayloadData } from "../middlewares/auth.middleware";

const JWT_SECRET = process.env.JWT_SECRET || "enem-super-secret-jwt-key-2026";

export class TrailController {
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
      const area = req.query.area as string | undefined;

      const trails = await trailService.listTrails(userId, area);
      return res.status(200).json(trails);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async getById(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);
      const trail = await trailService.getTrailById(
        req.params.id as string,
        userId
      );

      return res.status(200).json(trail);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async create(req: Request, res: Response): Promise<Response> {
    try {
      const trail = await trailService.createTrail(req.body);
      return res.status(201).json(trail);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const trail = await trailService.updateTrail(
        req.params.id as string,
        req.body
      );
      return res.status(200).json(trail);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async delete(req: Request, res: Response): Promise<Response> {
    try {
      const result = await trailService.deleteTrail(req.params.id as string);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async updateProgress(req: Request, res: Response): Promise<Response> {
    try {
      const userId = this.resolveUserId(req);
      const trailId = (req.params.id || req.body.trailId) as string;

      const progress = await trailService.upsertProgress({
        userId: userId as string,
        trailId,
        completedSteps: req.body.completedSteps,
        completedLessonIds: req.body.completedLessonIds,
        lessonId: req.body.lessonId,
        status: req.body.status,
      });

      return res.status(200).json(progress);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  async listUserProgress(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req.params.userId || this.resolveUserId(req)) as string;
      const progresses = await trailService.listUserProgress(userId);
      return res.status(200).json(progresses);
    } catch (error) {
      return this.handleError(error, res);
    }
  }

  private handleError(error: unknown, res: Response): Response {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error("[TrailController Error]:", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao gerenciar trilhas de estudo." });
  }
}

export const trailController = new TrailController();

