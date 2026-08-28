-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "videos" TEXT[] DEFAULT ARRAY[]::TEXT[];
