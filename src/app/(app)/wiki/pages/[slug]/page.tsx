import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { listAttachmentsFor } from "@/lib/files";
import { getBacklinks, getPageByPreviousSlug, getPageBySlug, getPageMeta, listPagesFlat } from "@/modules/wiki/queries";
import { getPageComments, getPageResearchMeta, listCitationSources, listTags, listUsers } from "@/modules/wiki/research-queries";
import { WikiShell } from "@/modules/wiki/components/wiki-shell";
import { listDocumentTemplates } from "@/modules/wiki/document-queries";
import { getWikiTypographyForUser, getWikiTypographyProfileForUser } from "@/modules/wiki/lib/wiki-typography.server";
import { listDeadlinesForContext, listTasksForContext } from "@/modules/projects/queries";
import { listGraphicAttachmentIds } from "@/modules/wiki/svg-assets";
import { getAppSettings } from "@/modules/settings/queries";
import { getPersonnelWorkspace } from "@/modules/personnel/queries";
import { listFundingProjects } from "@/modules/funding/queries";

export default async function WikiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ task?: string; deadline?: string }> }) {
  await connection();
  const currentUser = await requireUser(); const [{ slug }, query] = await Promise.all([params, searchParams]);
  const requestedSlug = decodeURIComponent(slug);
  const page = getPageBySlug(requestedSlug);
  if (!page) { const renamed = getPageByPreviousSlug(requestedSlug); if (renamed) redirect(`/wiki/pages/${encodeURIComponent(renamed.slug)}`); notFound(); }
  const meta = getPageMeta(page.id);
  // Diagrams live in the graphics panel, which has its own preview, insert and
  // remove actions; repeating them under attachments only doubles the list.
  const graphicAttachmentIds = listGraphicAttachmentIds(page.id);
  const currentUserTypography = getWikiTypographyProfileForUser(currentUser.id);
  const company = getAppSettings();
  const personnel = getPersonnelWorkspace(currentUser);
  const fundingProjects = listFundingProjects();
  const proposalData = {
    company: { name: company.companyName, address: company.address, uid: company.uid },
    people: personnel.people.map((person) => ({ id: person.id, name: person.name, role: person.employmentType })),
    fundingProjects: fundingProjects.map((project) => ({ id: project.id, name: project.name, programme: project.programName, fundingBody: project.fundingBody, start: project.projectStart, end: project.projectEnd, totalCostCents: project.totalProjectCostCents, approvedFundingCents: project.approvedFundingCents })),
  };
  return <WikiShell
    page={{ id: page.id, title: page.title, slug: page.slug, contentJson: page.contentJson, status: page.status, citationLocale: page.citationLocale, proofingLanguage: page.proofingLanguage, version: page.version, contentVersion: page.contentVersion, documentMode: page.documentMode, documentSettingsJson: page.documentSettingsJson, createdBy: page.createdBy }}
    backlinks={getBacklinks(page.id)} allPages={listPagesFlat().filter((item) => item.id !== page.id)}
    sources={listCitationSources(page.citationLocale)}
    allTags={listTags()}
    research={getPageResearchMeta(page.id, currentUser.id)}
    comments={getPageComments(page.id)} currentUserId={currentUser.id} users={listUsers()}
    attachments={listAttachmentsFor("wikiPage", page.id).filter((file) => !graphicAttachmentIds.has(file.id)).map((file) => ({ id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes }))}
    documentTemplates={listDocumentTemplates(currentUser.id)}
    typography={getWikiTypographyForUser(page.createdBy)}
    editableTypography={currentUserTypography.typography}
    typographyTemplates={currentUserTypography.templates}
    tasks={listTasksForContext("wikiPage", page.id)}
    deadlines={listDeadlinesForContext("wikiPage", page.id)}
    focusTaskId={query.task}
    focusDeadlineId={query.deadline}
    proposalData={proposalData}
    meta={meta ? { updatedAt: meta.updatedAt.getTime(), updatedByName: meta.updatedByName } : null}
  />;
}
