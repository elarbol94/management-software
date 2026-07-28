import type {
  ContextOwnerType,
  ContextRelationType,
  ContextTargetType,
} from "./schema";

export type ContextEntityType = ContextOwnerType | ContextTargetType;

export type ContextItemDto = {
  key: string;
  type: ContextEntityType;
  title: string;
  href: string;
  subtitle?: string;
  relation?: ContextRelationType | "contains" | "supports" | "evidence";
  linkId?: string;
  removable?: boolean;
};

export type EntityContextDto = {
  parents: ContextItemDto[];
  tasks: ContextItemDto[];
  wiki: ContextItemDto[];
  sources: ContextItemDto[];
};

export type ContextCandidateDto = {
  type: ContextEntityType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export type WorkspaceSearchResultDto = ContextCandidateDto & {
  path: string;
};
