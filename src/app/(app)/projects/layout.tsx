export const unstable_instant = {
  prefetch: "runtime",
  samples: [
    {
      cookies: [{ name: "locale", value: "de" }],
      headers: [["rsc", "1"], ["next-action", null]],
      params: { projectId: "sample" },
    },
  ],
};

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
