-- CreateTable
CREATE TABLE "department_leave_types" (
    "department_id" INTEGER NOT NULL,
    "leave_type_id" INTEGER NOT NULL,

    CONSTRAINT "department_leave_types_pkey" PRIMARY KEY ("department_id","leave_type_id")
);

-- CreateIndex
CREATE INDEX "department_leave_types_department_id" ON "department_leave_types"("department_id");

-- CreateIndex
CREATE INDEX "department_leave_types_leave_type_id" ON "department_leave_types"("leave_type_id");

-- AddForeignKey
ALTER TABLE "department_leave_types" ADD CONSTRAINT "department_leave_types_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_leave_types" ADD CONSTRAINT "department_leave_types_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
