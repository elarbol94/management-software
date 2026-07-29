import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession }));

import { POST } from "./route";

function importRequest(file?: File) {
  const data = new FormData();
  if (file) data.set("file", file);
  return new Request("http://test/api/wiki/import", {
    method: "POST",
    body: data,
  });
}

describe("POST /api/wiki/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user" } });
  });

  it("accepts supported BibTeX files", async () => {
    const response = await POST(
      importRequest(
        new File(
          ["@article{sample, title={Example}, author={Doe, Jane}}"],
          "library.bib",
        ),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      records: Array<{ title: string }>;
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.records[0]?.title).toBe("Example");
  });

  it("rejects missing, empty, and unsupported files", async () => {
    for (const request of [
      importRequest(),
      importRequest(new File([], "empty.bib")),
      importRequest(new File(["data"], "library.txt")),
      importRequest(new File(["not a bibliography"], "invalid.bib")),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(400);
    }
  });

  it("rejects unauthenticated requests", async () => {
    getSession.mockResolvedValue(null);
    const response = await POST(
      importRequest(new File(["data"], "library.ris")),
    );
    expect(response.status).toBe(401);
  });
});
