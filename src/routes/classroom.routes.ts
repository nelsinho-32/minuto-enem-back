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

export { classroomRoutes };

