"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteProject,
  setProjectStatus,
  upsertProject,
  type ProjectInput,
} from "@/modules/projects/actions";
import type { projects as projectsTable } from "@/modules/projects/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Project = typeof projectsTable.$inferSelect & { openTasks: number };

export function ProjectsClient({ projects }: { projects: Project[] }) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [items, setItems] = useState(projects);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [pending, setPending] = useState(false);

  function openDialog(project: Project | null) {
    setEditing(project);
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setColor(project?.color ?? "#2563eb");
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const input: ProjectInput = {
        id: editing?.id,
        name,
        description,
        color,
      };
      const saved = await upsertProject(input, [
        t("colOpen"),
        t("colInProgress"),
        t("colDone"),
      ]);
      setItems((current) => {
        const existing = current.find((project) => project.id === saved.id);
        const next = {
          ...saved,
          openTasks: existing?.openTasks ?? 0,
        };
        return existing
          ? current.map((project) => (project.id === saved.id ? next : project))
          : [next, ...current];
      });
      toast.success(tCommon("saved"));
      setDialogOpen(false);
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  async function onDelete(project: Project) {
    if (!window.confirm(tCommon("confirmDeleteTitle"))) return;
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== project.id));
    try {
      await deleteProject(project.id);
    } catch {
      setItems(previous);
      toast.error(tCommon("error"));
    }
  }

  async function toggleArchived(project: Project) {
    const previous = items;
    const status = project.status === "archived" ? "active" : "archived";
    setItems((current) =>
      current.map((item) =>
        item.id === project.id ? { ...item, status } : item,
      ),
    );
    try {
      await setProjectStatus(project.id, status);
    } catch {
      setItems(previous);
      toast.error(tCommon("error"));
    }
  }

  const active = items.filter((p) => p.status === "active");
  const archived = items.filter((p) => p.status === "archived");

  return (
    <div className="flex flex-col gap-6">
      <Button size="sm" className="self-start" onClick={() => openDialog(null)}>
        <Plus className="size-4" />
        {t("newProject")}
      </Button>

      {active.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((project) => (
          <Card key={project.id} className="relative transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/projects/${project.id}`}
                  className="flex min-w-0 items-center gap-2"
                >
                  <span
                    className="inline-block size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <CardTitle className="truncate">{project.name}</CardTitle>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-xs" />}
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openDialog(project)}>
                      <Pencil className="mr-2 size-4" />
                      {tCommon("edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleArchived(project)}>
                      <Archive className="mr-2 size-4" />
                      {t("archive")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDelete(project)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      {t("deleteProject")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {project.description && (
                <CardDescription className="line-clamp-2">
                  {project.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <Link
                href={`/projects/${project.id}`}
                className="text-sm text-muted-foreground"
              >
                {t("openTasks", { count: project.openTasks })}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("archive")}
          </h2>
          <div className="flex flex-col divide-y rounded-md border">
            {archived.map((project) => (
              <div key={project.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  className="inline-block size-2.5 rounded-full opacity-50"
                  style={{ backgroundColor: project.color }}
                />
                <span className="flex-1 text-sm text-muted-foreground">
                  {project.name}
                </span>
                <Badge variant="secondary">{t("archive")}</Badge>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={t("unarchive")}
                  onClick={() => toggleArchived(project)}
                >
                  <ArchiveRestore className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(project)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editProject") : t("newProject")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-name">{t("name")}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-description">{t("description")}</Label>
              <Textarea
                id="project-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-color">{t("color")}</Label>
              <input
                id="project-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-16 cursor-pointer rounded-md border bg-background p-1"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {tCommon("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
