import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";

export interface TriItemMetrics {
  questionId?: string;
  errorRate: number;
  successRate: number;
  difficultyTier: "EASY" | "MEDIUM" | "HARD";
  difficultyLogitB: number;
  dynamicWeight: number;
  basePoints: number;
}

export interface TriSimulationAnswerInput {
  questionId: string;
  selectedAnswer?: number;
  isCorrect?: boolean;
}

export class TriService {
  /**
   * Calcula o peso dinâmico e os parâmetros psicométricos da questão
   * com base na coluna `errorRate` (adicionada na migration `20260823230342_add_error_rate`).
   *
   * Na TRI do ENEM:
   * - Questões com menor taxa de erro (fáceis) possuem maior peso de consistência basal.
   * - Questões com maior taxa de erro (difíceis) elevam o teto de proficiência, mas
   *   são ponderadas pela coerência pedagógica do aluno.
   */
  calculateQuestionWeight(
    errorRateInput: number | null | undefined,
    questionId?: string
  ): TriItemMetrics {
    // Fallback neutro (50%) caso alguma questão não tenha errorRate preenchido
    const clampedErrorRate = Math.min(
      Math.max(Number(errorRateInput ?? 50), 5),
      95
    );
    const successRate = Number((100 - clampedErrorRate).toFixed(2));

    // Parâmetro de dificuldade b (escala logit [-3, +3])
    const pError = clampedErrorRate / 100;
    const rawLogit = Math.log(pError / (1 - pError));
    const difficultyLogitB = Number(
      Math.max(Math.min(rawLogit, 3), -3).toFixed(4)
    );

    let difficultyTier: "EASY" | "MEDIUM" | "HARD" = "MEDIUM";
    if (clampedErrorRate < 45) {
      difficultyTier = "EASY";
    } else if (clampedErrorRate > 70) {
      difficultyTier = "HARD";
    }

    // Peso dinâmico: itens mais acessíveis têm maior peso estrutural na coerência (1.0 a 1.95)
    const dynamicWeight = Number((1 + (100 - clampedErrorRate) / 100).toFixed(4));

    // Pontuação base de referência na escala ENEM para o item
    const basePoints = Number((dynamicWeight * 25).toFixed(2));

    return {
      ...(questionId ? { questionId } : {}),
      errorRate: clampedErrorRate,
      successRate,
      difficultyTier,
      difficultyLogitB,
      dynamicWeight,
      basePoints,
    };
  }

  /**
   * Simula a nota TRI (escala 300 a 1000 do ENEM) para uma bateria de respostas,
   * aplicando o cálculo de coerência pedagógica (penalização de provável chute em itens
   * de alta `errorRate` quando o aluno erra itens de baixa `errorRate`).
   */
  async simulateTriScore(answers: TriSimulationAnswerInput[]) {
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new AppError(
        "Envie ao menos uma resposta para calcular a simulação TRI.",
        400
      );
    }

    const questionIds = answers.map((a) => a.questionId);
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: {
        id: true,
        errorRate: true,
        correctAnswer: true,
        area: true,
        subject: true,
      },
    });

    if (questions.length === 0) {
      throw new AppError(
        "Nenhuma questão válida encontrada para os IDs informados.",
        404
      );
    }

    const questionMap = new Map(questions.map((q) => [q.id, q]));

    // Ordena os itens respondidos do mais fácil (menor errorRate) para o mais difícil (maior errorRate)
    const evaluatedItems = answers
      .map((ans) => {
        const q = questionMap.get(ans.questionId);
        if (!q) return null;

        const isCorrect =
          typeof ans.isCorrect === "boolean"
            ? ans.isCorrect
            : Number(ans.selectedAnswer) === q.correctAnswer;

        const metrics = this.calculateQuestionWeight(q.errorRate, q.id);

        return {
          questionId: q.id,
          area: q.area,
          subject: q.subject,
          isCorrect,
          ...metrics,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.errorRate - b.errorRate);

    // Calcula a taxa de acerto nas questões fáceis/médias para detectar incoerência (chute)
    const easierItems = evaluatedItems.filter((i) => i.errorRate <= 60);
    const easierAccuracy =
      easierItems.length > 0
        ? easierItems.filter((i) => i.isCorrect).length / easierItems.length
        : 0.5;

    let weightedHitSum = 0;
    let maxPossibleWeightedSum = 0;
    let coherencePenalties = 0;

    const detailedBreakdown = evaluatedItems.map((item) => {
      maxPossibleWeightedSum += item.dynamicWeight;

      if (!item.isCorrect) {
        return {
          ...item,
          coherenceFactor: 1,
          effectiveWeightEarned: 0,
        };
      }

      // Se a questão é difícil (errorRate > 70%), mas o aluno errou a maioria das fáceis,
      // a TRI reduz o peso do acerto por probabilidade de acerto casual (parâmetro c)
      let coherenceFactor = 1.0;
      if (item.difficultyTier === "HARD" && easierAccuracy < 0.5) {
        coherenceFactor = Number((0.45 + easierAccuracy * 0.5).toFixed(2));
        coherencePenalties++;
      }

      const effectiveWeightEarned = Number(
        (item.dynamicWeight * coherenceFactor).toFixed(4)
      );
      weightedHitSum += effectiveWeightEarned;

      return {
        ...item,
        coherenceFactor,
        effectiveWeightEarned,
      };
    });

    const normalizedMastery =
      maxPossibleWeightedSum > 0 ? weightedHitSum / maxPossibleWeightedSum : 0;

    // Escala oficial ENEM aproximada: piso 300, teto ~980
    const triScore = Number((300 + normalizedMastery * 680).toFixed(1));
    const rawCorrectCount = detailedBreakdown.filter((i) => i.isCorrect).length;

    return {
      triScore,
      totalQuestions: detailedBreakdown.length,
      correctAnswers: rawCorrectCount,
      rawAccuracyPercent: Number(
        ((rawCorrectCount / detailedBreakdown.length) * 100).toFixed(1)
      ),
      pedagogicalCoherencePercent: Number(
        (
          ((detailedBreakdown.length - coherencePenalties) /
            detailedBreakdown.length) *
          100
        ).toFixed(1)
      ),
      items: detailedBreakdown,
    };
  }
}

export const triService = new TriService();

