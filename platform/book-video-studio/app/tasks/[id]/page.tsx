import { getTask } from "@/lib/pipeline/repo";
import { notFound } from "next/navigation";
import TaskView from "@/components/intake/IntakeTaskView";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "demo") {
    return (
      <main>
        <TaskView taskId={id} />
      </main>
    );
  }
  const task = getTask(id);
  if (!task) notFound();
  return (
    <main>
      <TaskView taskId={id} />
    </main>
  );
}
