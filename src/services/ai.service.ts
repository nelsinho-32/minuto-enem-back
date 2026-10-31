import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";
import { searchService } from "./search.service";
import { triService } from "./tri.service";

const AI_MODEL = "gemini-3.8-flash";

export interface TutorRagInput {
  questionId: string;
  studentDoubt?: string;
  selectedOption?: number;
  previousInteractionId?: string;
}

export interface EssayCorrectionInput {
  theme?: string;
  essayText?: string;
  imageBase64?: string;
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp" | string;
}

export interface EnemCompetencyScore {
  number: 1 | 2 | 3 | 4 | 5;
  title: string;
  score: number; // 0, 40, 80, 120, 160 ou 200
  feedback: string;
  strengths: string[];
  improvements: string[];
}

export interface EssayCorrectionResult {
  totalScore: number;
  competencies: EnemCompetencyScore[];
  generalFeedback: string;
  transcribedText?: string;
}

export interface DistractorDiagnosisInput {
  questionId: string;
  selectedOption: number | string; // 0..4 ou 'A'..'E'
  studentDoubt?: string;
}

export interface DistractorDiagnosisResult {
  questionId: string;
  selectedOptionIndex: number;
  selectedOptionLetter: string;
  isCorrect: boolean;
  trapType: string;
  shortExplanation: string;
  correctAnswerIndex: number;
  correctAnswerLetter: string;
  keyTakeaway: string;
}

export interface GenerateEnemQuestionInput {
  skill: string;
  area?: string;
  subject?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  saveToDatabase?: boolean;
}

export interface GeneratedEnemQuestionResult {
  id?: string;
  year: number;
  area: string;
  subject: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  text: string;
  options: string[];
  correctAnswer: number;
  correctAnswerLetter: string;
  explanation: string;
  errorRate: number;
  skill: string;
  savedToDatabase: boolean;
}

export class AiService {
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new AppError(
        "Variável GEMINI_API_KEY não configurada no servidor.",
        500
      );
    }

    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey });
    }

    return this.client;
  }

  /**
   * (a) Tutor RAG Socrático:
   * - Recupera a questão no banco + aulas teóricas relacionadas (RAG sobre `Lesson`/`Subject`)
   *   e métricas TRI (`errorRate`) da questão.
   * - Guia o raciocínio do aluno com dicas conceituais e eliminação de distratores,
   *   SEM NUNCA revelar a alternativa correta diretamente.
   */
  async tutorQuestionRAG(input: TutorRagInput) {
    const {
      questionId,
      studentDoubt,
      selectedOption,
      previousInteractionId,
    } = input;

    if (!questionId) {
      throw new AppError("O ID da questão (questionId) é obrigatório.", 400);
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      throw new AppError("Questão não encontrada.", 404);
    }

    // 1. Recuperação de Contexto Pedagógico (RAG): busca aulas teóricas relacionadas
    const relatedLessons = await prisma.lesson.findMany({
      where: {
        OR: [
          {
            subject: {
              OR: [
                { slug: { contains: question.subject, mode: "insensitive" } },
                { name: { contains: question.subject, mode: "insensitive" } },
              ],
            },
          },
          {
            content: {
              contains: question.text.slice(0, 35).replace(/[^\w\sÀ-ÿ]/g, ""),
              mode: "insensitive",
            },
          },
        ],
      },
      include: { subject: true },
      take: 3,
    });

    // Busca questões semanticamente próximas como apoio de contexto
    const similarQuestions = await searchService.searchQuestions({
      query: question.text.slice(0, 300),
      area: question.area,
      limit: 2,
    });

    const triMetrics = triService.calculateQuestionWeight(
      question.errorRate,
      question.id
    );

    const ragContext =
      relatedLessons.length > 0
        ? relatedLessons
            .map(
              (l) =>
                `[Aula: ${l.title} (${l.subject.name})]\n${l.content.slice(
                  0,
                  900
                )}`
            )
            .join("\n\n---\n\n")
        : "Utilize a matriz de referência oficial do ENEM correspondente à área da questão.";

    const optionsText = Array.isArray(question.options)
      ? question.options.join("\n")
      : JSON.stringify(question.options);

    const systemInstruction = `
Você é um Tutor Socrático especialista no ENEM.
REGRAS PEDAGÓGICAS INVIOLÁVEIS:
1. NUNCA revele qual letra (A, B, C, D ou E) é o gabarito nem entregue a resposta pronta.
2. Analise o texto-base, o comando da questão e o contexto teórico recuperado via RAG.
3. Explique os conceitos-chave exigidos pela questão e mostre como interpretar as pistas do enunciado.
4. Se o aluno informou uma alternativa que marcou por engano, explique por que aquela linha de pensamento é um distrator comum no ENEM e faça uma pergunta instigante para guiá-lo à resposta certa.
5. Mantenha um tom encorajador, didático e objetivo em português do Brasil.
`.trim();

    const userPrompt = `
=== DADOS DA QUESTÃO (ENEM ${question.year} - Área: ${question.area} / Disciplina: ${question.subject}) ===
Nível de Dificuldade TRI: ${triMetrics.difficultyTier} (Taxa de erro histórica: ${triMetrics.errorRate}%)

Enunciado:
${question.text}

Alternativas:
${optionsText}

=== BASE TEÓRICA RECUPERADA (RAG) ===
${ragContext}

=== INTERAÇÃO DO ALUNO ===
${
  selectedOption !== undefined
    ? `Alternativa em que o aluno está pensando (índice 0-4): ${selectedOption}`
    : "O aluno ainda não escolheu uma alternativa."
}
Dúvida do aluno: ${
      studentDoubt ||
      "Estou com dúvida em como interpretar esta questão. Pode me dar uma dica sem revelar a resposta?"
    }
`.trim();

    const ai = this.getClient();
    const interaction = await ai.interactions.create({
      model: AI_MODEL,
      system_instruction: systemInstruction,
      input: userPrompt,
      ...(previousInteractionId
        ? { previous_interaction_id: previousInteractionId }
        : {}),
    });

    return {
      interactionId: interaction.id,
      questionId: question.id,
      triMetrics,
      referencedLessons: relatedLessons.map((l) => ({
        id: l.id,
        title: l.title,
        subject: l.subject.name,
      })),
      relatedQuestionIds: similarQuestions.results
        .filter((q) => q.id !== question.id)
        .map((q) => q.id),
      tutorGuidance: interaction.output_text,
    };
  }

  /**
   * (b) Corretor de Redações Multimodal (Texto e/ou Imagem da folha de redação):
   * - Avalia a redação segundo a matriz oficial das 5 Competências do ENEM (0 a 200 cada, total 0 a 1000).
   * - Suporta envio do texto digitado (`essayText`), foto da redação manuscrita (`imageBase64`) ou ambos.
   */
  async gradeEssay(input: EssayCorrectionInput): Promise<EssayCorrectionResult> {
    const { theme, essayText, imageBase64, imageMimeType } = input;

    if (!essayText?.trim() && !imageBase64?.trim()) {
      throw new AppError(
        "Envie o texto da redação (essayText) ou a imagem da folha (imageBase64) para correção.",
        400
      );
    }

    const systemInstruction = `
Você é um corretor oficial de redações do ENEM (INEP).
Avalie a redação dissertativo-argumentativa com rigor técnico nas 5 Competências oficiais do ENEM:
- Competência 1: Demonstrar domínio da modalidade escrita formal da língua portuguesa (0 a 200 pontos, em múltiplos de 40: 0, 40, 80, 120, 160, 200).
- Competência 2: Compreender a proposta de redação e aplicar conceitos das várias áreas de conhecimento para desenvolver o tema, dentro dos limites estruturais do texto dissertativo-argumentativo em prosa (0 a 200 pontos, múltiplos de 40).
- Competência 3: Selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista (0 a 200 pontos, múltiplos de 40).
- Competência 4: Demonstrar conhecimento dos mecanismos linguísticos necessários para a construção da argumentação / coesão textual (0 a 200 pontos, múltiplos de 40).
- Competência 5: Elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos e contendo os 5 elementos (Agente, Ação, Meio/Modo, Efeito e Detalhamento) (0 a 200 pontos, múltiplos de 40).

Se uma imagem for enviada, transcreva fielmente o texto manuscrito no campo "transcribedText" antes de pontuar.
Retorne estritamente um objeto JSON válido seguindo o schema solicitado.
`.trim();

    const promptText = `
Tema da Redação: ${theme || "Tema livre / inferir pelo texto da redação"}
${
  essayText?.trim()
    ? `\nTexto da Redação enviado pelo aluno:\n"""\n${essayText.trim()}\n"""`
    : "\nO aluno enviou uma imagem da redação manuscrita. Transcreva-a e faça a correção completa nas 5 competências do ENEM."
}
`.trim();

    const multimodalInput: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mime_type: string }
    > = [{ type: "text", text: promptText }];

    if (imageBase64?.trim()) {
      // Remove prefixo data:image/...;base64, caso o frontend tenha enviado Data URL
      const cleanBase64 = imageBase64
        .trim()
        .replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

      multimodalInput.push({
        type: "image",
        data: cleanBase64,
        mime_type: imageMimeType || "image/jpeg",
      });
    }

    const essayResponseSchema = {
      type: "object",
      properties: {
        totalScore: {
          type: "integer",
          description: "Nota total da redação de 0 a 1000 (soma das 5 competências).",
        },
        generalFeedback: {
          type: "string",
          description: "Parecer pedagógico geral sobre a redação do aluno.",
        },
        transcribedText: {
          type: "string",
          description:
            "Transcrição do texto (caso enviado por imagem) ou texto analisado.",
        },
        competencies: {
          type: "array",
          description: "Avaliação detalhada de cada uma das 5 competências do ENEM.",
          items: {
            type: "object",
            properties: {
              number: {
                type: "integer",
                description: "Número da competência (1 a 5).",
              },
              title: {
                type: "string",
                description: "Nome oficial da competência.",
              },
              score: {
                type: "integer",
                description: "Nota da competência: 0, 40, 80, 120, 160 ou 200.",
              },
              feedback: {
                type: "string",
                description: "Justificativa pedagógica para a nota atribuída.",
              },
              strengths: {
                type: "array",
                items: { type: "string" },
                description: "Pontos fortes observados nesta competência.",
              },
              improvements: {
                type: "array",
                items: { type: "string" },
                description: "O que melhorar para alcançar 200 pontos nesta competência.",
              },
            },
            required: [
              "number",
              "title",
              "score",
              "feedback",
              "strengths",
              "improvements",
            ],
          },
        },
      },
      required: ["totalScore", "generalFeedback", "competencies"],
    };

    const ai = this.getClient();
    const interaction = await ai.interactions.create({
      model: AI_MODEL,
      system_instruction: systemInstruction,
      input: multimodalInput,
      response_format: essayResponseSchema,
    });

    const rawText = interaction.output_text || "{}";

    try {
      const parsed = JSON.parse(rawText) as EssayCorrectionResult;
      // Garante que totalScore reflita exatamente a soma das 5 competências
      if (Array.isArray(parsed.competencies) && parsed.competencies.length > 0) {
        parsed.totalScore = parsed.competencies.reduce(
          (acc, c) => acc + (Number(c.score) || 0),
          0
        );
      }
      return parsed;
    } catch {
      throw new AppError(
        "Falha ao estruturar o retorno da correção de redação pela IA.",
        500
      );
    }
  }

  /**
   * (c) Diagnóstico de Distratores:
   * Analisa a alternativa incorreta assinalada pelo aluno e retorna uma explicação
   * pedagógica curta e assertiva focada na armadilha cognitiva do distrator.
   */
  async diagnoseDistractor(
    input: DistractorDiagnosisInput
  ): Promise<DistractorDiagnosisResult> {
    const { questionId, selectedOption, studentDoubt } = input;

    if (!questionId) {
      throw new AppError("O ID da questão (questionId) é obrigatório.", 400);
    }

    if (selectedOption === undefined || selectedOption === null) {
      throw new AppError(
        "A alternativa selecionada (selectedOption) é obrigatória.",
        400
      );
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      throw new AppError("Questão não encontrada.", 404);
    }

    const letters = ["A", "B", "C", "D", "E"];

    // Normaliza a alternativa selecionada para índice (0 a 4)
    let selectedIndex: number;
    if (typeof selectedOption === "string") {
      const upper = selectedOption.trim().toUpperCase();
      const matchIndex = letters.indexOf(upper);
      if (matchIndex !== -1) {
        selectedIndex = matchIndex;
      } else {
        const parsed = parseInt(upper, 10);
        selectedIndex = isNaN(parsed) ? 0 : parsed;
      }
    } else {
      selectedIndex = Number(selectedOption);
    }

    if (selectedIndex < 0 || selectedIndex > 4) {
      throw new AppError(
        "Índice de alternativa inválido. Utilize valores de 0 a 4 (ou 'A' a 'E').",
        400
      );
    }

    const selectedLetter = letters[selectedIndex] || "A";
    const correctIndex = question.correctAnswer;
    const correctLetter = letters[correctIndex] || "A";

    const optionsList: string[] = Array.isArray(question.options)
      ? (question.options as string[])
      : [];

    const selectedOptionText =
      optionsList[selectedIndex] || `Alternativa ${selectedLetter}`;
    const correctOptionText =
      optionsList[correctIndex] || `Alternativa ${correctLetter}`;

    // Se o aluno assinalou a alternativa correta
    if (selectedIndex === correctIndex) {
      return {
        questionId: question.id,
        selectedOptionIndex: selectedIndex,
        selectedOptionLetter: selectedLetter,
        isCorrect: true,
        trapType: "Nenhuma (Alternativa Correta)",
        shortExplanation: `Parabéns! A alternativa (${selectedLetter}) é o gabarito oficial desta questão. Ela atende com precisão ao comando e à tese central do texto.`,
        correctAnswerIndex: correctIndex,
        correctAnswerLetter: correctLetter,
        keyTakeaway:
          "Excelente interpretação! Continue identificando as ideias centrais do texto-base.",
      };
    }

    // Diagnóstico do Distrator com Gemini AI
    const systemInstruction = `
Você é um especialista em psicometria e elaboração de itens do ENEM (INEP).
Sua missão é diagnosticar DISTRATORES (alternativas incorretas planejadas para capturar erros comuns de interpretação).
REGRAS:
1. Explique por que a alternativa escolhida é uma "pegadinha" / armadilha típica do ENEM (ex: Extrapolação, Generalização indevida, Falsa Causa, Redução, Contradição).
2. Forneça uma explicação pedagógica curta (1 a 2 parágrafos) focada no erro de raciocínio.
3. Forneça um "keyTakeaway" (conselho prático de 1 frase para o aluno não cair mais nessa pegadinha).
4. Retorne estritamente um JSON no schema solicitado.
`.trim();

    const userPrompt = `
=== QUESTÃO DO ENEM (Área: ${question.area} / Disciplina: ${question.subject}) ===
Enunciado:
${question.text}

Todas as Alternativas:
${optionsList.join("\n")}

Gabarito Oficial: Letra ${correctLetter} -> ${correctOptionText}

Alternativa Incorreta Assinalada pelo Aluno:
Letra ${selectedLetter} -> ${selectedOptionText}

${studentDoubt ? `Dúvida expressada pelo aluno: "${studentDoubt}"` : ""}
`.trim();

    const distractorSchema = {
      type: "object",
      properties: {
        trapType: {
          type: "string",
          description:
            "Classificação da armadilha do distrator (ex: Extrapolação do texto-base, Inversão de causa e efeito, Redução indevida).",
        },
        shortExplanation: {
          type: "string",
          description:
            "Explicação curta e didática do motivo de a alternativa ser incorreta e por que ela atrai quem lê com pressa.",
        },
        keyTakeaway: {
          type: "string",
          description:
            "Dica pontual de ouro para o estudante reconhecer e descartar esse distrator no exame real.",
        },
      },
      required: ["trapType", "shortExplanation", "keyTakeaway"],
    };

    const ai = this.getClient();
    const interaction = await ai.interactions.create({
      model: AI_MODEL,
      system_instruction: systemInstruction,
      input: userPrompt,
      response_format: distractorSchema,
    });

    const rawOutput = interaction.output_text || "{}";
    let parsedData = {
      trapType: "Distrator de Interpretação",
      shortExplanation:
        "Essa alternativa induz ao erro por conter elementos verossímeis, mas que não respondem com exatidão ao comando da questão.",
      keyTakeaway:
        "Sempre confronte a alternativa diretamente com o verbo de comando do enunciado.",
    };

    try {
      parsedData = { ...parsedData, ...JSON.parse(rawOutput) };
    } catch {
      // Mantém o fallback caso ocorra erro no parse do JSON
    }

    return {
      questionId: question.id,
      selectedOptionIndex: selectedIndex,
      selectedOptionLetter: selectedLetter,
      isCorrect: false,
      trapType: parsedData.trapType,
      shortExplanation: parsedData.shortExplanation,
      correctAnswerIndex: correctIndex,
      correctAnswerLetter: correctLetter,
      keyTakeaway: parsedData.keyTakeaway,
    };
  }

  /**
   * (d) Gerador de Questões Inéditas:
   * Cria uma questão inédita e contextualizada no formato oficial do ENEM baseada
   * em uma habilidade específica quando o banco local esgotar.
   */
  async generateEnemQuestion(
    input: GenerateEnemQuestionInput
  ): Promise<GeneratedEnemQuestionResult> {
    const {
      skill,
      area = "linguagens",
      subject = "Geral",
      difficulty = "MEDIUM",
      saveToDatabase = true,
    } = input;

    if (!skill || !skill.trim()) {
      throw new AppError(
        "A habilidade ou competência da Matriz do ENEM é obrigatória.",
        400
      );
    }

    const estimatedErrorRate =
      difficulty === "EASY" ? 32.5 : difficulty === "HARD" ? 78.4 : 56.0;

    const systemInstruction = `
Você é a banca oficial de elaboração de itens do ENEM (INEP).
Crie uma questão INÉDITA, contextualizada e rigorosamente alinhada à Matriz de Referência do ENEM.
DIRETRIZES TÉCNICAS DO ENEM:
1. Texto-base autêntico: pode ser trecho literário, artigo de divulgação científica, crônica, notícia jornalística, poema ou experimento contextualizado.
2. Comando de comando claro e inequívoco, sem pegadinhas gramaticais baratas, exigindo a aplicação direta da habilidade informada.
3. 5 alternativas homogêneas (prefixadas com 'A) ', 'B) ', 'C) ', 'D) ', 'E) '), onde:
   - Apenas UMA é correta e responde perfeitamente ao enunciado.
   - As outras 4 são distratores plausíveis baseados em falhas comuns de interpretação (sem alternativas absurdas ou que se anulem).
4. Gabarito com índice de 0 a 4 (0=A, 1=B, 2=C, 3=D, 4=E).
5. Resolução comentada (explanation) detalhando o porquê da alternativa correta e o erro de cada distrator.
6. Retorne estritamente um JSON no schema solicitado.
`.trim();

    const userPrompt = `
Habilidade/Competência Alvo: "${skill.trim()}"
Área do Conhecimento: "${area}"
Disciplina Específica: "${subject}"
Nível de Dificuldade Desejado: "${difficulty}" (Taxa empírica esperada de erro: ~${estimatedErrorRate}%)
`.trim();

    const questionSchema = {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "Texto-base contextualizado seguido do comando do enunciado.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description:
            "Array com exatamente 5 alternativas formatadas: ['A) ...', 'B) ...', 'C) ...', 'D) ...', 'E) ...'].",
        },
        correctAnswer: {
          type: "integer",
          description: "Índice numérico da resposta correta (0 a 4).",
        },
        explanation: {
          type: "string",
          description:
            "Justificativa pedagógica completa da resposta correta e dos distratores.",
        },
        area: {
          type: "string",
          description: "Área do conhecimento (ex: linguagens, ciencias-natureza, etc.).",
        },
        subject: {
          type: "string",
          description: "Nome da disciplina (ex: Biologia, Língua Portuguesa, etc.).",
        },
      },
      required: ["text", "options", "correctAnswer", "explanation"],
    };

    const ai = this.getClient();
    const interaction = await ai.interactions.create({
      model: AI_MODEL,
      system_instruction: systemInstruction,
      input: userPrompt,
      response_format: questionSchema,
    });

    const rawOutput = interaction.output_text || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      throw new AppError(
        "Falha ao gerar questão inédita com a IA. Tente novamente.",
        500
      );
    }

    const letters = ["A", "B", "C", "D", "E"];
    const finalCorrectIndex = Math.min(
      Math.max(Number(parsed.correctAnswer) || 0, 0),
      4
    );

    const questionData = {
      year: new Date().getFullYear(),
      area: parsed.area || area,
      subject: parsed.subject || subject,
      difficulty,
      text: parsed.text,
      options: parsed.options,
      correctAnswer: finalCorrectIndex,
      correctAnswerLetter: letters[finalCorrectIndex],
      explanation: parsed.explanation,
      errorRate: estimatedErrorRate,
      skill: skill.trim(),
    };

    let savedId: string | undefined;

    if (saveToDatabase) {
      const created = await prisma.question.create({
        data: {
          year: questionData.year,
          area: questionData.area,
          subject: questionData.subject,
          difficulty: questionData.difficulty,
          text: questionData.text,
          options: questionData.options,
          correctAnswer: questionData.correctAnswer,
          explanation: questionData.explanation,
          errorRate: questionData.errorRate,
        },
        select: { id: true },
      });
      savedId = created.id;
    }

    return {
      ...(savedId ? { id: savedId } : {}),
      ...questionData,
      savedToDatabase: Boolean(savedId),
    };
  }
}

export const aiService = new AiService();

