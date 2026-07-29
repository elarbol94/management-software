declare module "@citation-js/core" {
  export class Cite {
    constructor(data?: unknown);
    format(
      output: "bibliography" | "citation",
      options?: { format?: "text" | "html"; template?: string; lang?: string },
    ): string;
  }
}

declare module "@citation-js/plugin-csl";
