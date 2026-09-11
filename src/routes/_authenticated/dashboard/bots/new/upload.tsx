import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectUpload } from "@/components/ProjectUpload";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/dashboard/bots/new/upload")({
  validateSearch: z.object({ botId: z.string().uuid().optional() }),
  component: UploadStep,
});

function UploadStep() {
  const { botId } = Route.useSearch();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload project</h1>
        <p className="text-sm text-muted-foreground">
          Step 2 of the deployment wizard: safe extraction, static analysis and a real compatibility
          report.
        </p>
      </div>
      {botId ? (
        <ProjectUpload botId={botId} />
      ) : (
        <Card className="p-6 text-sm text-muted-foreground">
          Select a bot first —{" "}
          <Link to="/dashboard/bots" className="text-primary hover:underline">
            go to your bots
          </Link>{" "}
          and open one to upload its project.
        </Card>
      )}
    </div>
  );
}
