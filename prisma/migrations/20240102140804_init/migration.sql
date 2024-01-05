-- CreateTable
CREATE TABLE "Beatmapset" (
    "id" INTEGER NOT NULL,
    "lastUpdate" TIMESTAMP(3) NOT NULL,
    "i_createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "i_updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beatmapset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeatmapsetSnapshot" (
    "beatmapsetId" INTEGER NOT NULL,
    "lastModified" TIMESTAMP(3) NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "crc32" TEXT NOT NULL,
    "i_createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "i_updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeatmapsetSnapshot_pkey" PRIMARY KEY ("beatmapsetId","lastModified")
);

-- CreateIndex
CREATE INDEX "BeatmapsetSnapshot_beatmapsetId_lastModified_idx" ON "BeatmapsetSnapshot"("beatmapsetId", "lastModified");

-- AddForeignKey
ALTER TABLE "BeatmapsetSnapshot" ADD CONSTRAINT "BeatmapsetSnapshot_beatmapsetId_fkey" FOREIGN KEY ("beatmapsetId") REFERENCES "Beatmapset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
