import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DEFAULT_TRIGGER_STAGE } from "@/lib/crm/trigger-stage";
import { MOCK_PIPELINE_STAGES } from "@/lib/crm/stages";
import { createClient } from "@/lib/supabase/server";
import { saveTriggerStage } from "./actions";

// CRM Custom Stage Mapping (Sprint 3, Ticket 16). Static component shell —
// the pipeline dropdown is seeded from the mock stage array, not a live CRM
// handshake (no OAuth in v1.2). Reads/writes go through the RLS-scoped
// client, so everything here is tenant-bounded at the DB layer.
export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/admin/login"); // middleware already enforces this; defense in depth
  }

  // Any of the tenant's workspaces is representative — Save keeps them
  // tenant-consistent (see actions.ts). No workspaces yet → DB default.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("trigger_stage")
    .limit(1)
    .maybeSingle();
  const currentStage = workspace?.trigger_stage ?? DEFAULT_TRIGGER_STAGE;
  const selectedStage =
    MOCK_PIPELINE_STAGES.find((stage) => stage.toLowerCase() === currentStage.toLowerCase()) ??
    MOCK_PIPELINE_STAGES[2];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <p className="m-0 text-sm">
          <Link href="/admin" className="text-neutral-500 no-underline hover:underline dark:text-neutral-400">
            ← Back to dashboard
          </Link>
        </p>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="m-0 text-sm text-neutral-500 dark:text-neutral-400">
          Align automated workspace provisioning with your CRM pipeline.
        </p>
      </div>

      <Card>
        <form action={saveTriggerStage} className="m-0 flex max-w-none flex-col gap-0 p-0">
          <CardHeader>
            <CardTitle>CRM stage mapping</CardTitle>
            <CardDescription>
              When a HubSpot or Salesforce deal-stage webhook matches the trigger stage below, a buyer
              workspace is provisioned automatically. Any other stage is skipped.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Label htmlFor="trigger_stage">
              Trigger stage
              <Select id="trigger_stage" name="trigger_stage" defaultValue={selectedStage}>
                {MOCK_PIPELINE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </Select>
            </Label>
            <p className="m-0 text-xs text-neutral-500 dark:text-neutral-400">
              Stages come from a static mock pipeline in v1.2 — no live CRM connection. Matching is
              case-insensitive.
            </p>
            {saved ? (
              <p className="m-0 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                Trigger stage saved.
              </p>
            ) : null}
            {error ? (
              <p className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button type="submit">Save Settings</Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
