export const unstable_instant = {
  prefetch: "runtime",
  samples: [
    {
      cookies: [{ name: "locale", value: "de" }],
      headers: [["rsc", "1"], ["next-action", null]],
    },
  ],
};

export default function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
