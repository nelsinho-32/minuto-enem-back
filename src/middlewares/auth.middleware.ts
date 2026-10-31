import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

export interface JwtPayloadData {
  sub: string;
  email: string;
  role: Role;
}

// Extensão da tipagem do Express Request para incluir o usuário autenticado
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: Role;
      };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "enem-super-secret-jwt-key-2026";

/**
 * Middleware de Autenticação (`auth`):
 * Valida o token JWT enviado no header `Authorization: Bearer <token>`
 */
export function auth(
  req: Request,
  res: Response,
  next: NextFunction
): Response | void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: "Token de autenticação não fornecido.",
    });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2) {
    return res.status(401).json({
      error: "Formato de token inválido.",
    });
  }

  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({
      error: "Token malformatado. Utilize o padrão Bearer.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayloadData;

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      error: "Token inválido ou expirado.",
    });
  }
}

/**
 * Middleware de Autorização (isTeacher):
 * Bloqueia a requisição (ex.: criação de Classroom) caso a role do usuário não seja TEACHER.
 */
export function isTeacher(
  req: Request,
  res: Response,
  next: NextFunction
): Response | void {
  if (!req.user) {
    return res.status(401).json({
      error: "Usuário não autenticado.",
    });
  }

  if (req.user.role !== Role.TEACHER) {
    return res.status(403).json({
      error: "Acesso negado. Apenas professores (TEACHER) podem realizar esta ação.",
    });
  }

  return next();
}

export const authenticate = auth;

