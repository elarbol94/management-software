import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listAttachmentsFor } from "@/lib/files";
import { getBacklinks, getPageBySlug, getPageMeta, listPagesFlat } from "@/modules/wiki/queries";
import { getCitationSourcesForPage, getPageComments, getPageResearchMeta, listSources, listUsers } from "@/modules/wiki/research-queries";
import { WikiShell } from "@/modules/wiki/components/wiki-shell";
import { listDocumentTemplates } from "@/modules/wiki/document-queries";
import { getWikiTypographyForUser, getWikiTypographyProfileForUser } from "@/modules/wiki/lib/wiki-typography.server";
import { listDeadlinesForContext, listTasksForContext } from "@/modules/projects/queries";

export default async function WikiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ task?: string; deadline?: string }> }) {
  const currentUser = await requireUser(); const [{ slug }, query] = await Promise.all([params, searchParams]);
  const page = getPageBySlug(decodeURIComponent(slug)); if (!page) notFound();
  const meta = getPageMeta(page.id);
  const currentUserTypography = getWikiTypographyProfileForUser(currentUser.id);
  return <WikiShell
    page={{ id: page.id, title: page.title, slug: page.slug, contentJson: page.contentJson, status: page.status, citationLocale: page.citationLocale, version: page.version, documentMode: page.documentMode, documentSettingsJson: page.documentSettingsJson, createdBy: page.createdBy }}
    backlinks={getBacklinks(page.id)} allPages={listPagesFlat().filter((item) => item.id !== page.id)}
    sources={listSources({ limit: 500 }).map((source) => ({ id: source.id, title: source.title, issuedDate: source.issuedDate, contributors: source.contributors }))}
    citationSources={getCitationSourcesForPage(page.id)} research={getPageResearchMeta(page.id, currentUser.id)}
    comments={getPageComments(page.id)} currentUserId={currentUser.id} users={listUsers()}
    attachments={listAttachmentsFor("wikiPage", page.id).map((file) => ({ id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes }))}
    documentTemplates={listDocumentTemplates(currentUser.id)}
    typography={getWikiTypographyForUser(page.createdBy)}
    editableTypography={currentUserTypography.typography}
    typographyTemplates={currentUserTypography.templates}
    tasks={listTasksForContext("wikiPage", page.id)}
    deadlines={listDeadlinesForContext("wikiPage", page.id)}
    focusTaskId={query.task}
    focusDeadlineId={query.deadline}
    meta={meta ? { updatedAt: meta.updatedAt.getTime(), updatedByName: meta.updatedByName } : null}
  />;
}
