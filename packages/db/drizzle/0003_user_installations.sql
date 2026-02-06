CREATE TABLE "user_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_installations" ADD CONSTRAINT "user_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_installations" ADD CONSTRAINT "user_installations_installation_id_github_app_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_app_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_installations_user_installation_idx" ON "user_installations" USING btree ("user_id","installation_id");--> statement-breakpoint
CREATE INDEX "user_installations_user_id_idx" ON "user_installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_installations_installation_id_idx" ON "user_installations" USING btree ("installation_id");--> statement-breakpoint

-- Backfill: copy existing userId associations into the join table
INSERT INTO "user_installations" ("user_id", "installation_id")
SELECT "user_id", "id"
FROM "github_app_installations"
WHERE "user_id" IS NOT NULL
ON CONFLICT DO NOTHING;