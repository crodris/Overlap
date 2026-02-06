CREATE TABLE "branch_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"change_type" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sha" varchar(40) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_pusher_github_id" bigint,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_app_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" bigint NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "overlap_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"overlap_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"source_change_type" varchar(20) NOT NULL,
	"target_change_type" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"target_branch_id" uuid NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"severity" varchar(20) DEFAULT 'low' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"overlap_id" uuid NOT NULL,
	"alert_type" varchar(20) NOT NULL,
	"comment_id" bigint,
	"check_run_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"github_pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"state" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"installation_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"full_name" varchar(512) NOT NULL,
	"default_branch" varchar(255) DEFAULT 'main' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "repository_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"pruning_days" integer DEFAULT 14 NOT NULL,
	"ignored_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify_on_new_overlap" boolean DEFAULT true NOT NULL,
	"notify_on_severity_increase" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_settings_repository_id_unique" UNIQUE("repository_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"username" varchar(255) NOT NULL,
	"email" varchar(255),
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"delivery_id" varchar(100) NOT NULL,
	"repository_id" uuid,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
ALTER TABLE "branch_files" ADD CONSTRAINT "branch_files_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlap_files" ADD CONSTRAINT "overlap_files_overlap_id_overlaps_id_fk" FOREIGN KEY ("overlap_id") REFERENCES "public"."overlaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlaps" ADD CONSTRAINT "overlaps_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlaps" ADD CONSTRAINT "overlaps_source_branch_id_branches_id_fk" FOREIGN KEY ("source_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlaps" ADD CONSTRAINT "overlaps_target_branch_id_branches_id_fk" FOREIGN KEY ("target_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_alerts" ADD CONSTRAINT "pr_alerts_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_alerts" ADD CONSTRAINT "pr_alerts_overlap_id_overlaps_id_fk" FOREIGN KEY ("overlap_id") REFERENCES "public"."overlaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_github_app_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_app_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_settings" ADD CONSTRAINT "repository_settings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_files_branch_path_idx" ON "branch_files" USING btree ("branch_id","file_path");--> statement-breakpoint
CREATE INDEX "branch_files_branch_id_idx" ON "branch_files" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "branch_files_file_path_idx" ON "branch_files" USING btree ("file_path");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_repo_name_idx" ON "branches" USING btree ("repository_id","name");--> statement-breakpoint
CREATE INDEX "branches_repository_id_idx" ON "branches" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "branches_last_seen_at_idx" ON "branches" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "installations_installation_id_idx" ON "github_app_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_github_id_idx" ON "organizations" USING btree ("github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overlap_files_overlap_path_idx" ON "overlap_files" USING btree ("overlap_id","file_path");--> statement-breakpoint
CREATE INDEX "overlap_files_overlap_id_idx" ON "overlap_files" USING btree ("overlap_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overlaps_branches_idx" ON "overlaps" USING btree ("source_branch_id","target_branch_id");--> statement-breakpoint
CREATE INDEX "overlaps_repository_id_idx" ON "overlaps" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "overlaps_status_idx" ON "overlaps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "overlaps_severity_idx" ON "overlaps" USING btree ("severity");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_alerts_pr_overlap_idx" ON "pr_alerts" USING btree ("pull_request_id","overlap_id");--> statement-breakpoint
CREATE INDEX "pr_alerts_pull_request_id_idx" ON "pr_alerts" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "pr_alerts_overlap_id_idx" ON "pr_alerts" USING btree ("overlap_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repo_number_idx" ON "pull_requests" USING btree ("repository_id","github_pr_number");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_id_idx" ON "pull_requests" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "pull_requests_branch_id_idx" ON "pull_requests" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "pull_requests_state_idx" ON "pull_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_github_id_idx" ON "repositories" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "repositories_installation_id_idx" ON "repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "repositories_full_name_idx" ON "repositories" USING btree ("full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_id_idx" ON "users" USING btree ("github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_delivery_id_idx" ON "webhook_events" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_events_event_type_idx" ON "webhook_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events" USING btree ("created_at");