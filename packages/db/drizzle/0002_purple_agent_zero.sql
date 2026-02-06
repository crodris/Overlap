DROP INDEX "push_subscriptions_endpoint_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_user_endpoint_idx" ON "push_subscriptions" USING btree ("user_id","endpoint");