-- AddForeignKey
ALTER TABLE "maintenance_ticket" ADD CONSTRAINT "maintenance_ticket_assigneeStaffId_fkey" FOREIGN KEY ("assigneeStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
