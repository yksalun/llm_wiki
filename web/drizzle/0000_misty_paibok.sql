CREATE SCHEMA IF NOT EXISTS "llm_wiki_web";
--> statement-breakpoint
CREATE TABLE "llm_wiki_web"."project_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"root_path" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"has_purpose" boolean NOT NULL,
	"has_schema" boolean NOT NULL,
	"has_wiki_directory" boolean NOT NULL,
	"has_raw_sources_directory" boolean NOT NULL,
	"last_known_updated_at" timestamp with time zone,
	"last_scanned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_snapshots_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "llm_wiki_web"."project_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_path" text NOT NULL,
	"status" text NOT NULL,
	"warning_message" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
