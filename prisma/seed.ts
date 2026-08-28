import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config'; 

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Iniciando o Seed do Banco de Dados...");

  // ==========================================
  // 1. SEED DAS MATÉRIAS E AULAS
  // ==========================================
  console.log("🧹 Limpando matérias antigas do banco para forçar atualização...");
  await prisma.lesson.deleteMany();
  await prisma.subject.deleteMany();

  console.log("📚 Buscando arquivo: materias.json...");
  const materiasPath = path.join(process.cwd(), 'prisma', 'data', 'materias.json');
  
  if (fs.existsSync(materiasPath)) {
    const materiasData = JSON.parse(fs.readFileSync(materiasPath, 'utf-8'));
    
    console.log(`⏳ Inserindo ${materiasData.length} matérias no banco...`);
    for (const subject of materiasData) {
      await prisma.subject.create({
        data: {
          name: subject.name,
          slug: subject.slug,
          icon: subject.icon,
          lessons: {
            create: subject.lessons.map((lesson: any) => ({
              title: lesson.title,
              content: lesson.content,
              videos: lesson.videos || [],        
              references: lesson.references || [] 
            }))
          }
        }
      });
    }
    console.log("✅ Matérias e Aulas inseridas com sucesso!");
  } else {
    console.log("⚠️ Arquivo materias.json não encontrado. Pulando etapa.");
  }

  console.log("--------------------------------------------------");

  // ==========================================
  // 2. SEED DAS QUESTÕES DO ENEM
  // ==========================================
  console.log("📄 Buscando arquivo: 2015_COMPLETO.json...");
  const questionsPath = path.join(process.cwd(), 'prisma', 'data', '2015_COMPLETO.json');

  if (fs.existsSync(questionsPath)) {
    const questionsRaw = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));
    
    const questionsData = questionsRaw.map((q: any) => ({
      ...q,
      year: q.year || 2015,         
      area: q.area || "Geral",      
      subject: q.subject || "Geral" 
    }));

    console.log("🧹 Limpando questões antigas do banco...");
    await prisma.question.deleteMany(); 
    
    console.log(`⏳ Inserindo ${questionsData.length} questões no banco...`);
    await prisma.question.createMany({
      data: questionsData,
    });

    console.log("✅ Questões do ENEM inseridas com sucesso!");
  } else {
    console.log("⚠️ Arquivo 2015_COMPLETO.json não encontrado. Pulando etapa.");
  }
}

main()
  .catch((e) => {
    console.error("❌ Erro crítico no seed:\n", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log("🏁 Seed finalizado.");
  });