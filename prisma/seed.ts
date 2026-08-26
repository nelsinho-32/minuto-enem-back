import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Iniciando processamento em lote (Bulk Insert)...');

  // Aponta para a nova pasta 'data' dentro de 'prisma'
  const dataFolder = path.join(__dirname, 'data');
  
  // Verifica se a pasta existe
  if (!fs.existsSync(dataFolder)) {
    console.error('❌ Erro: Pasta prisma/data não encontrada.');
    process.exit(1);
  }

  // Pega todos os arquivos terminados em .json dentro da pasta
  const files = fs.readdirSync(dataFolder).filter(file => file.endsWith('.json'));

  if (files.length === 0) {
    console.log('⚠️ Nenhum arquivo .json encontrado na pasta prisma/data.');
    return;
  }

  // Loop inteligente que processa cada arquivo
  for (const file of files) {
    console.log(`\n📄 Lendo arquivo: ${file}...`);
    const filePath = path.join(dataFolder, file);
    const fileData = fs.readFileSync(filePath, 'utf-8');
    const questions = JSON.parse(fileData);

    console.log(`⏳ Inserindo ${questions.length} questões de ${file} no banco...`);

    // Injeção em massa hiper rápida
    const result = await prisma.question.createMany({
      data: questions,
      skipDuplicates: true,
    });

    console.log(`✅ Sucesso! ${result.count} questões do arquivo ${file} foram salvas.`);
  }

  console.log('\n🚀 Seed completo! Todas as provas disponíveis foram processadas e salvas no banco.');
}

main()
  .catch((e) => {
    console.error('❌ Erro crítico no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });