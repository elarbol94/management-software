"use client";

import { createContext, useContext, useMemo } from "react";

type ProjectFocusModeContextValue = {
  isFocused: boolean;
};

const ProjectFocusModeContext = createContext<ProjectFocusModeContextValue>({
  isFocused: false,
});

/**
 * Route-local and transient: unlike wiki focus preferences, this boundary never
 * reads or writes localStorage. The marker lets the ancestor shell hide chrome
 * during the first server render of a shared focus URL.
 */
export function ProjectFocusProvider({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ isFocused: active }), [active]);
  return (
    <ProjectFocusModeContext.Provider value={value}>
      <div
        className="contents"
        data-project-focus-root={active ? "true" : undefined}
      >
        {children}
      </div>
    </ProjectFocusModeContext.Provider>
  );
}

export function useProjectFocusMode() {
  return useContext(ProjectFocusModeContext);
}
