import { Router } from "express";
import { classroomController } from "../controllers/classroom.controller";
import { auth, isTeacher } from "../middlewares/auth.middleware";

const classroomRoutes = Router();

// Criação de sala bloqueada caso a role não seja TEACHER
classroomRoutes.post("/", auth, isTeacher, (req, res) =>
  classroomController.create(req, res)
);

// Matrícula de aluno autenticado em uma sala existente (N:N)
classroomRoutes.post("/enroll", auth, (req, res) =>
  classroomController.enroll(req, res)
);

// Copiloto Docente: Diagnóstico Analítico da Turma e Geração Automática de Tarefa de Reforço
classroomRoutes.get("/:id/copilot-analytics", auth, isTeacher, (req, res) =>
  classroomController.copilotAnalytics(req, res)
);
classroomRoutes.post("/:id/copilot-analytics", auth, isTeacher, (req, res) =>
  classroomController.copilotAnalytics(req, res)
);
classroomRoutes.post("/:id/copilot-reinforce", auth, isTeacher, (req, res) =>
  classroomController.copilotAnalytics(req, res)
);

// Aprovação da Tarefa de Reforço pelo Professor
classroomRoutes.patch("/tasks/:taskId/approve", auth, isTeacher, (req, res) =>
  classroomController.approveTask(req, res)
);
classroomRoutes.post("/tasks/:taskId/approve", auth, isTeacher, (req, res) =>
  classroomController.approveTask(req, res)
);

export { classroomRoutes };

