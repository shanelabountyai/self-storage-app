-- CreateTable
CREATE TABLE "city" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "intro" TEXT,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "city_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "city_state_slug_key" ON "city"("state", "slug");

-- AddForeignKey
ALTER TABLE "city" ADD CONSTRAINT "city_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
