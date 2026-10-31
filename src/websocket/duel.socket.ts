import crypto from "crypto";
import { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma";
import { streakService } from "../services/streak.service";
import { triService } from "../services/tri.service";

export interface DuelPlayerState {
  userId: string;
  socketId: string;
  name: string;
  score: number;
  correctCount: number;
  answers: Array<{
    questionId: string;
    selectedAnswer: number;
    isCorrect: boolean;
    pointsEarned: number;
  }>;
}

export interface DuelMatchRoom {
  matchId: string;
  subject?: string;
  status: "WAITING" | "IN_PROGRESS" | "FINISHED";
  questions: Array<{
    id: string;
    year: number;
    area: string;
    subject: string;
    text: string;
    options: unknown;
    correctAnswer: number;
    errorRate: number | null;
  }>;
  players: Map<string, DuelPlayerState>;
  createdAt: Date;
}

const activeMatches = new Map<string, DuelMatchRoom>();

export function setupDuelWebSocket(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log(`⚡ [Socket.io] Cliente conectado: ${socket.id}`);

    /**
     * Evento 1: `join_match`
     * Faz matchmaking em uma sala aberta ou entra em um `matchId` específico.
     */
    socket.on(
      "join_match",
      async (payload: {
        userId: string;
        userName?: string;
        matchId?: string;
        subject?: string;
        questionsCount?: number;
      }) => {
        try {
          const {
            userId,
            userName,
            matchId: requestedMatchId,
            subject,
            questionsCount = 5,
          } = payload || {};

          if (!userId) {
            socket.emit("match_error", {
              error: "O userId é obrigatório para entrar em um duelo.",
            });
            return;
          }

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true },
          });

          const displayName = user?.name || userName || "Estudante";

          // Procura sala específica ou uma sala em espera (WAITING) com menos de 2 jogadores
          let room: DuelMatchRoom | undefined;

          if (requestedMatchId && activeMatches.has(requestedMatchId)) {
            room = activeMatches.get(requestedMatchId);
          } else if (!requestedMatchId) {
            for (const candidate of activeMatches.values()) {
              if (
                candidate.status === "WAITING" &&
                candidate.players.size < 2 &&
                (!subject || candidate.subject === subject)
              ) {
                room = candidate;
                break;
              }
            }
          }

          // Se não encontrou sala disponível, cria uma nova e sorteia as questões no Prisma
          if (!room) {
            const newMatchId =
              requestedMatchId ||
              `duel_${crypto.randomBytes(4).toString("hex")}`;

            const questions = await prisma.question.findMany({
              where: subject
                ? {
                    OR: [
                      { subject: { equals: subject, mode: "insensitive" } },
                      { area: { equals: subject, mode: "insensitive" } },
                    ],
                  }
                : undefined,
              take: Math.min(Math.max(Number(questionsCount) || 5, 1), 15),
              orderBy: { year: "desc" },
            });

            room = {
              matchId: newMatchId,
              subject,
              status: "WAITING",
              questions,
              players: new Map(),
              createdAt: new Date(),
            };

            activeMatches.set(newMatchId, room);
          }

          room.players.set(userId, {
            userId,
            socketId: socket.id,
            name: displayName,
            score: 0,
            correctCount: 0,
            answers: [],
          });

          socket.join(room.matchId);

          const sanitizedQuestions = room.questions.map((q) => ({
            id: q.id,
            year: q.year,
            area: q.area,
            subject: q.subject,
            text: q.text,
            options: q.options,
            triMetrics: triService.calculateQuestionWeight(q.errorRate, q.id),
          }));

          io.to(room.matchId).emit("match_joined", {
            matchId: room.matchId,
            status: room.status,
            players: Array.from(room.players.values()).map((p) => ({
              userId: p.userId,
              name: p.name,
              score: p.score,
            })),
            questionsCount: sanitizedQuestions.length,
          });

          // Quando 2 jogadores estão na sala, inicia a partida automaticamente
          if (room.players.size >= 2 && room.status === "WAITING") {
            room.status = "IN_PROGRESS";
            io.to(room.matchId).emit("match_start", {
              matchId: room.matchId,
              status: room.status,
              questions: sanitizedQuestions,
              players: Array.from(room.players.values()).map((p) => ({
                userId: p.userId,
                name: p.name,
                score: p.score,
              })),
            });
          }
        } catch (error) {
          console.error("[Socket join_match Error]:", error);
          socket.emit("match_error", {
            error: "Erro ao ingressar na sala de duelo.",
          });
        }
      }
    );

    /**
     * Evento 2: `submit_answer`
     * Processa a resposta de um jogador no duelo usando o peso dinâmico TRI (`errorRate`)
     * e atualiza o placar em tempo real.
     */
    socket.on(
      "submit_answer",
      async (payload: {
        matchId: string;
        userId: string;
        questionId: string;
        selectedAnswer: number;
        timeMs?: number;
      }) => {
        try {
          const {
            matchId,
            userId,
            questionId,
            selectedAnswer,
            timeMs = 15000,
          } = payload || {};

          const room = activeMatches.get(matchId);
          if (!room) {
            socket.emit("match_error", {
              error: "Sala de duelo não encontrada.",
            });
            return;
          }

          const player = room.players.get(userId);
          if (!player) {
            socket.emit("match_error", {
              error: "Jogador não pertence a esta sala de duelo.",
            });
            return;
          }

          // Evita resposta duplicada para a mesma questão na partida
          if (player.answers.some((a) => a.questionId === questionId)) {
            return;
          }

          const question = room.questions.find((q) => q.id === questionId);
          if (!question) {
            socket.emit("match_error", {
              error: "Questão não pertence a este duelo.",
            });
            return;
          }

          const isCorrect =
            Number(selectedAnswer) === Number(question.correctAnswer);

          const triMetrics = triService.calculateQuestionWeight(
            question.errorRate,
            question.id
          );

          // Bônus de velocidade (até +10 pontos extras para respostas rápidas)
          const speedBonus = isCorrect
            ? Math.max(0, Math.round((30000 - Math.min(timeMs, 30000)) / 3000))
            : 0;

          const pointsEarned = isCorrect
            ? Number((triMetrics.basePoints + speedBonus).toFixed(2))
            : 0;

          player.score = Number((player.score + pointsEarned).toFixed(2));
          if (isCorrect) {
            player.correctCount += 1;
          }

          player.answers.push({
            questionId,
            selectedAnswer: Number(selectedAnswer),
            isCorrect,
            pointsEarned,
          });

          // Registra a tentativa da questão no banco de dados
          await prisma.questionAttempt
            .create({
              data: {
                userId,
                questionId,
                selectedAnswer: Number(selectedAnswer),
                isCorrect,
              },
            })
            .catch(() => null);

          socket.emit("answer_result", {
            matchId,
            questionId,
            isCorrect,
            correctAnswer: question.correctAnswer,
            pointsEarned,
            totalScore: player.score,
            triMetrics,
          });

          io.to(matchId).emit("scoreboard_update", {
            matchId,
            scoreboard: Array.from(room.players.values()).map((p) => ({
              userId: p.userId,
              name: p.name,
              score: p.score,
              correctCount: p.correctCount,
              answeredCount: p.answers.length,
            })),
          });

          // Verifica se todos os jogadores da sala já responderam todas as questões
          const totalQuestions = room.questions.length;
          const allFinished =
            totalQuestions > 0 &&
            Array.from(room.players.values()).every(
              (p) => p.answers.length >= totalQuestions
            );

          if (allFinished && room.status !== "FINISHED") {
            await finalizeDuelMatch(io, room);
          }
        } catch (error) {
          console.error("[Socket submit_answer Error]:", error);
          socket.emit("match_error", {
            error: "Erro ao processar resposta no duelo.",
          });
        }
      }
    );

    /**
     * Evento 3: `match_end`
     * Encerra a partida, calcula o vencedor, simula a nota TRI e atualiza a ofensiva (streak)
     * de todos os participantes no banco de dados via Prisma.
     */
    socket.on("match_end", async (payload: { matchId: string }) => {
      try {
        const room = activeMatches.get(payload?.matchId);
        if (!room) {
          socket.emit("match_error", {
            error: "Sala de duelo não encontrada para encerramento.",
          });
          return;
        }

        if (room.status === "FINISHED") {
          return;
        }

        await finalizeDuelMatch(io, room);
      } catch (error) {
        console.error("[Socket match_end Error]:", error);
        socket.emit("match_error", {
          error: "Erro ao encerrar duelo.",
        });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 [Socket.io] Cliente desconectado: ${socket.id}`);
    });
  });
}

/**
 * Finaliza a sala de duelo, calcula o vencedor, simula a TRI de cada jogador,
 * atualiza o `currentStreak` / `longestStreak` / `iceFreezes` / `xp` no banco
 * e emite o evento `match_end` para todos os clientes da sala.
 */
async function finalizeDuelMatch(
  io: Server,
  room: DuelMatchRoom
): Promise<void> {
  room.status = "FINISHED";

  const playersArray = Array.from(room.players.values()).sort(
    (a, b) => b.score - a.score
  );

  const winner =
    playersArray.length > 1 && playersArray[0].score === playersArray[1].score
      ? null // Empate
      : playersArray[0] || null;

  const playersSummary = await Promise.all(
    playersArray.map(async (player) => {
      const isWinner = winner?.userId === player.userId;
      const bonusXp = isWinner ? 50 : 20;

      // 1. Atualiza a ofensiva (streak) no banco de dados ao concluir a partida
      const updatedStreak = await streakService
        .registerActivity(player.userId)
        .catch(() => null);

      // 2. Concede o bônus de XP da partida
      await prisma.user
        .update({
          where: { id: player.userId },
          data: { xp: { increment: bonusXp } },
        })
        .catch(() => null);

      // 3. Calcula a proficiência TRI da partida caso o jogador tenha respondido questões
      const triSimulation =
        player.answers.length > 0
          ? await triService
              .simulateTriScore(
                player.answers.map((a) => ({
                  questionId: a.questionId,
                  selectedAnswer: a.selectedAnswer,
                  isCorrect: a.isCorrect,
                }))
              )
              .catch(() => null)
          : null;

      return {
        userId: player.userId,
        name: player.name,
        score: player.score,
        correctCount: player.correctCount,
        xpEarned: bonusXp,
        triScore: triSimulation?.triScore ?? null,
        streak: updatedStreak
          ? {
              currentStreak: updatedStreak.currentStreak,
              longestStreak: updatedStreak.longestStreak,
              iceFreezes: updatedStreak.iceFreezes,
              lastStudyDate: updatedStreak.lastStudyDate,
            }
          : null,
      };
    })
  );

  io.to(room.matchId).emit("match_end", {
    matchId: room.matchId,
    status: "FINISHED",
    winnerId: winner?.userId ?? null,
    winnerName: winner?.name ?? null,
    isDraw: winner === null && playersArray.length > 1,
    players: playersSummary,
    finishedAt: new Date().toISOString(),
  });

  activeMatches.delete(room.matchId);
}

