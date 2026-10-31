import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";
import { streakService } from "./streak.service";

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || "enem-super-secret-jwt-key-2026";
const JWT_EXPIRES_IN = "7d";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role?: Role;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class AuthService {
  /**
   * Registra um novo usuário com senha criptografada via bcrypt
   * e retorna os dados do usuário junto com o token JWT.
   */
  async register(data: RegisterInput) {
    const { name, email, password, role } = data;

    if (!name || !email || !password) {
      throw new AppError("Nome, e-mail e senha são obrigatórios.", 400);
    }

    if (password.length < 6) {
      throw new AppError("A senha deve ter pelo menos 6 caracteres.", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new AppError("Este e-mail já está cadastrado.", 409);
    }

    const userRole: Role =
      role && Object.values(Role).includes(role) ? role : Role.STUDENT;

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: userRole,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        xp: true,
        currentStreak: true,
        longestStreak: true,
        iceFreezes: true,
        lastStudyDate: true,
        createdAt: true,
      },
    });

    const token = this.generateToken(user.id, user.email, user.role);

    return {
      user,
      token,
    };
  }

  /**
   * Autentica o usuário validando a senha com bcrypt,
   * executa a verificação dinâmica da ofensiva no login e gera o JWT.
   */
  async login(data: LoginInput) {
    const { email, password } = data;

    if (!email || !password) {
      throw new AppError("E-mail e senha são obrigatórios.", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new AppError("Credenciais inválidas.", 401);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError("Credenciais inválidas.", 401);
    }

    // Verifica e atualiza dinamicamente a ofensiva do usuário no momento do login
    const streakStatus = await streakService.verifyStreakOnLogin(user.id);

    const token = this.generateToken(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        xp: user.xp,
        currentStreak: streakStatus.currentStreak,
        longestStreak: streakStatus.longestStreak,
        iceFreezes: streakStatus.iceFreezes,
        lastStudyDate: streakStatus.lastStudyDate,
      },
      streakStatus: {
        missedDays: streakStatus.missedDays,
        iceFreezesUsed: streakStatus.iceFreezesUsed,
        streakReset: streakStatus.streakReset,
      },
      token,
    };
  }

  private generateToken(userId: string, email: string, role: Role): string {
    return jwt.sign(
      {
        email,
        role,
      },
      JWT_SECRET,
      {
        subject: userId,
        expiresIn: JWT_EXPIRES_IN,
      }
    );
  }
}

export const authService = new AuthService();

