-- Add post-completion correction metadata to production_facts

ALTER TABLE "production_facts" ADD COLUMN "postCompletionCorrection" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "production_facts" ADD COLUMN "correctionReason" TEXT;
